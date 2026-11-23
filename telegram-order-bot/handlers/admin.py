"""Admin-mode handlers: demo toggle, statistics, order status management, CSV export."""

from __future__ import annotations

import html
from datetime import datetime, timezone

from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import BufferedInputFile, CallbackQuery

from calculator import format_price
from config import Settings
from db import (
    ORDER_STATUSES,
    STATUS_BADGES,
    export_orders_csv,
    get_all_orders,
    get_order_by_id,
    get_order_stats,
    is_demo_admin,
    next_order_status,
    set_demo_admin,
    update_order_status,
)
from keyboards import admin_panel_kb, main_menu_kb

router = Router(name="admin")


def _render_admin_dashboard(settings: Settings, user_id: int) -> tuple[str, list, bool]:
    stats = get_order_stats(settings.db_path)
    orders = get_all_orders(settings.db_path, limit=6)
    demo_mode = not settings.is_admin(user_id) and is_demo_admin(settings.db_path, user_id)

    lines = [
        "🛠 <b>Админ-панель управления заявками</b>" + (" <i>(Демо-режим)</i>" if demo_mode else ""),
        "",
        f"📊 <b>Всего заявок:</b> {stats.total_orders}",
        f"• 🆕 Новые: <b>{stats.new_count}</b> | ⚙️ В работе: <b>{stats.in_progress_count}</b> | ✅ Готово: <b>{stats.done_count}</b>",
        f"💰 <b>Сумма воронки:</b> <code>{format_price(stats.total_pipeline_amount, settings.currency)}</code>",
        "",
    ]
    if orders:
        lines.append("👇 <b>Нажмите на заявку, чтобы сменить статус (Новая → В работе → Готово):</b>")
    else:
        lines.append("<i>Заявок пока нет. Создайте тестовую заявку в главном меню!</i>")

    return "\n".join(lines), orders, demo_mode


async def _safe_edit_admin(callback: CallbackQuery, text: str, markup) -> None:
    if not callback.message:
        return
    try:
        await callback.message.edit_text(text, reply_markup=markup)
    except TelegramBadRequest as exc:
        if "message is not modified" not in str(exc).lower():
            raise


@router.callback_query(F.data == "admin:panel")
async def cb_admin_panel(callback: CallbackQuery, settings: Settings) -> None:
    """Open Admin Panel (enables Demo Admin mode automatically for client showcase)."""
    user_id = callback.from_user.id
    if not settings.is_admin(user_id) and not is_demo_admin(settings.db_path, user_id):
        set_demo_admin(settings.db_path, user_id, True)

    text, orders, demo_mode = _render_admin_dashboard(settings, user_id)
    await _safe_edit_admin(callback, text, admin_panel_kb(orders, is_demo_mode=demo_mode))
    await callback.answer("Админ-режим активен")


@router.callback_query(F.data == "admin:demo_off")
async def cb_admin_demo_off(callback: CallbackQuery, settings: Settings) -> None:
    """Disable Demo Admin mode and return to the client main menu."""
    user_id = callback.from_user.id
    set_demo_admin(settings.db_path, user_id, False)
    safe_name = html.escape(callback.from_user.first_name or "Коллега")
    await _safe_edit_admin(
        callback,
        f"👋 <b>Демо-режим админки выключен, {safe_name}.</b>\n\nВы вернулись в клиентское меню.",
        main_menu_kb(is_admin_active=settings.is_admin(user_id)),
    )
    await callback.answer("Вышли из демо-админки")


@router.callback_query(F.data.startswith("admin:cycle:"))
async def cb_admin_cycle_status(callback: CallbackQuery, settings: Settings) -> None:
    """Cycle order status: Новая -> В работе -> Готово -> Новая."""
    assert callback.data is not None
    try:
        order_id = int(callback.data.split(":", maxsplit=2)[2])
    except ValueError:
        await callback.answer("Некорректный ID заявки", show_alert=True)
        return

    order = get_order_by_id(settings.db_path, order_id)
    if not order:
        await callback.answer("Заявка не найдена", show_alert=True)
        return

    new_status = next_order_status(order.status)
    updated = update_order_status(settings.db_path, order_id, new_status)
    text, orders, demo_mode = _render_admin_dashboard(settings, callback.from_user.id)
    await _safe_edit_admin(callback, text, admin_panel_kb(orders, is_demo_mode=demo_mode))
    badge = STATUS_BADGES.get(updated.status if updated else new_status, new_status)
    await callback.answer(f"Заявка #{order_id}: {badge}")


@router.callback_query(F.data.startswith("admin:set:"))
async def cb_admin_set_status(callback: CallbackQuery, settings: Settings) -> None:
    """Set explicit status by index."""
    assert callback.data is not None
    parts = callback.data.split(":")
    if len(parts) != 4:
        await callback.answer("Неверный формат команды", show_alert=True)
        return
    try:
        order_id = int(parts[2])
        status_idx = int(parts[3])
        target_status = ORDER_STATUSES[status_idx]
    except (ValueError, IndexError):
        await callback.answer("Неверный статус", show_alert=True)
        return

    updated = update_order_status(settings.db_path, order_id, target_status)
    if not updated:
        await callback.answer("Заявка не найдена", show_alert=True)
        return

    text, orders, demo_mode = _render_admin_dashboard(settings, callback.from_user.id)
    await _safe_edit_admin(callback, text, admin_panel_kb(orders, is_demo_mode=demo_mode))
    await callback.answer(f"Статус #{order_id}: {target_status}")


@router.callback_query(F.data == "admin:export_csv")
async def cb_admin_export_csv(callback: CallbackQuery, settings: Settings) -> None:
    """Export all orders to CSV and send as a Telegram document."""
    csv_payload = export_orders_csv(settings.db_path)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    filename = f"clientflow_orders_{stamp}.csv"
    document = BufferedInputFile(csv_payload.encode("utf-8"), filename=filename)

    if callback.message:
        await callback.message.answer_document(
            document=document,
            caption="📥 <b>Выгрузка заявок в CSV</b> (UTF-8, готово для Excel и Google Sheets).",
        )
    await callback.answer("CSV сформирован")
