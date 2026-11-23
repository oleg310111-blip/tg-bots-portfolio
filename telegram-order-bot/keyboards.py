"""Inline keyboards for ClientFlow Demo Bot."""

from __future__ import annotations

from typing import Iterable

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from calculator import CALCULATOR_OPTIONS
from db import ORDER_STATUSES, OrderRecord, STATUS_BADGES


def main_menu_kb(is_admin_active: bool = False) -> InlineKeyboardMarkup:
    """Build the main menu inline keyboard."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="💼 Услуги и кейсы", callback_data="menu:cases"),
        InlineKeyboardButton(text="🧮 Калькулятор", callback_data="menu:calc"),
    )
    builder.row(
        InlineKeyboardButton(text="📝 Оформить заявку", callback_data="order:start"),
        InlineKeyboardButton(text="📋 Мои заявки", callback_data="menu:my_orders"),
    )
    admin_label = (
        "🛠 Админ-режим (Открыть)"
        if is_admin_active
        else "🛠 Админ-режим (Демо)"
    )
    builder.row(InlineKeyboardButton(text=admin_label, callback_data="admin:panel"))
    return builder.as_markup()


def cases_kb() -> InlineKeyboardMarkup:
    """Keyboard under the Services & Cases screen."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="🧮 Рассчитать стоимость", callback_data="menu:calc"),
    )
    builder.row(
        InlineKeyboardButton(text="📝 Оставить заявку", callback_data="order:start"),
    )
    builder.row(
        InlineKeyboardButton(text="⬅️ Главное меню", callback_data="menu:home"),
    )
    return builder.as_markup()


def calculator_kb(selected_keys: Iterable[str]) -> InlineKeyboardMarkup:
    """Interactive calculator toggle buttons."""
    selected = set(selected_keys)
    builder = InlineKeyboardBuilder()

    for opt in CALCULATOR_OPTIONS:
        mark = "✅" if opt.key in selected else "⬜"
        builder.row(
            InlineKeyboardButton(
                text=f"{mark} {opt.short_title} (+{opt.price} ₽)",
                callback_data=f"calc:toggle:{opt.key}",
            )
        )

    builder.row(
        InlineKeyboardButton(text="📝 Заказать с расчётом", callback_data="order:from_calc"),
        InlineKeyboardButton(text="🔄 Сбросить", callback_data="calc:reset"),
    )
    builder.row(InlineKeyboardButton(text="⬅️ Главное меню", callback_data="menu:home"))
    return builder.as_markup()


def fsm_cancel_kb(allow_use_username: bool = False, username: str | None = None) -> InlineKeyboardMarkup:
    """Cancel button (and optional one-tap @username fill) during FSM steps."""
    builder = InlineKeyboardBuilder()
    if allow_use_username and username:
        clean = username.lstrip("@")
        builder.row(
            InlineKeyboardButton(
                text=f"📲 Использовать @{clean}",
                callback_data="order:use_tg_username",
            )
        )
    builder.row(InlineKeyboardButton(text="❌ Отменить заявку", callback_data="order:cancel"))
    return builder.as_markup()


def my_orders_kb() -> InlineKeyboardMarkup:
    """Keyboard under My Orders screen."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="🔄 Обновить статусы", callback_data="menu:my_orders"),
        InlineKeyboardButton(text="📝 Новая заявка", callback_data="order:start"),
    )
    builder.row(InlineKeyboardButton(text="⬅️ Главное меню", callback_data="menu:home"))
    return builder.as_markup()


def admin_panel_kb(orders: list[OrderRecord], is_demo_mode: bool) -> InlineKeyboardMarkup:
    """Admin dashboard keyboard with status-cycle buttons and CSV export."""
    builder = InlineKeyboardBuilder()

    for order in orders[:6]:
        badge = STATUS_BADGES.get(order.status, order.status)
        builder.row(
            InlineKeyboardButton(
                text=f"#{order.id} • {order.client_name[:14]} • {badge}",
                callback_data=f"admin:cycle:{order.id}",
            )
        )

    builder.row(
        InlineKeyboardButton(text="📥 Экспорт CSV", callback_data="admin:export_csv"),
        InlineKeyboardButton(text="🔄 Обновить", callback_data="admin:panel"),
    )
    if is_demo_mode:
        builder.row(
            InlineKeyboardButton(text="🚪 Выйти из демо-админки", callback_data="admin:demo_off"),
        )
    builder.row(InlineKeyboardButton(text="⬅️ Главное меню", callback_data="menu:home"))
    return builder.as_markup()


def admin_order_detail_kb(order: OrderRecord) -> InlineKeyboardMarkup:
    """Direct status buttons for a specific order if needed."""
    builder = InlineKeyboardBuilder()
    buttons = [
        InlineKeyboardButton(
            text=("• " if order.status == st else "") + STATUS_BADGES[st],
            callback_data=f"admin:set:{order.id}:{idx}",
        )
        for idx, st in enumerate(ORDER_STATUSES)
    ]
    builder.row(*buttons)
    builder.row(InlineKeyboardButton(text="⬅️ Назад в админку", callback_data="admin:panel"))
    return builder.as_markup()
