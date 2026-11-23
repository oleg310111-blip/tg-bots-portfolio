"""Client-side handlers: menu, cases, interactive calculator, 3-step FSM, and my orders."""

from __future__ import annotations

import html
from typing import Any

from aiogram import Bot, F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from calculator import (
    calculate_estimate,
    format_price,
    render_calculator_message,
    toggle_option,
)
from config import Settings
from db import (
    STATUS_BADGES,
    create_order,
    get_user_orders,
    is_demo_admin,
    validate_contact,
    validate_description,
    validate_name,
)
from keyboards import (
    calculator_kb,
    cases_kb,
    fsm_cancel_kb,
    main_menu_kb,
    my_orders_kb,
)

router = Router(name="client")


class OrderForm(StatesGroup):
    """3-step FSM for collecting a client order."""

    name = State()
    contact = State()
    description = State()


def _welcome_text(bot_name: str, first_name: str | None) -> str:
    safe_user = html.escape(first_name or "Коллега")
    return (
        f"👋 <b>Привет, {safe_user}!</b>\n\n"
        f"Это <b>{html.escape(bot_name)}</b> — эталонный бот для приёма заявок, "
        "расчёта стоимости и управления заказами прямо в Telegram.\n\n"
        "<b>Что можно протестировать прямо сейчас:</b>\n"
        "• 💼 <b>Услуги и кейсы</b> — примеры решений и сроки запуска\n"
        "• 🧮 <b>Калькулятор</b> — переключатели опций с пересчётом цены на лету\n"
        "• 📝 <b>Оформить заявку</b> — воронка в 3 шага с валидацией\n"
        "• 📋 <b>Мои заявки</b> — статусы в реальном времени\n"
        "• 🛠 <b>Админ-режим</b> — демо-панель со статистикой, сменой статуса и CSV"
    )


def _cases_text() -> str:
    return (
        "💼 <b>Услуги и готовые кейсы</b>\n\n"
        "1️⃣ <b>Бот-воронка для заявок и записи</b>\n"
        "• Калькулятор цены, 3-шаговая анкета, уведомления в Telegram и Google Sheets.\n"
        "• <i>Срок запуска: 12–24 ч • От 2 500 ₽</i>\n\n"
        "2️⃣ <b>Магазин / каталог с приёмом оплат</b>\n"
        "• Корзина, ЮKassa / Карта / Crypto, автовыдача файлов и статусы заказов.\n"
        "• <i>Срок запуска: 1–2 дня • От 4 000 ₽</i>\n\n"
        "3️⃣ <b>CRM-интеграция и парсинг лидов</b>\n"
        "• База клиентов в SQLite/PostgreSQL, рассылки, синхронизация по REST API.\n"
        "• <i>Срок запуска: 1–2 дня • От 3 700 ₽</i>\n\n"
        "👇 Рассчитайте стоимость под вашу задачу или оставьте заявку:"
    )


async def _safe_edit(
    callback: CallbackQuery,
    text: str,
    reply_markup: Any,
) -> None:
    if not callback.message:
        return
    try:
        await callback.message.edit_text(text, reply_markup=reply_markup)
    except TelegramBadRequest as exc:
        if "message is not modified" not in str(exc).lower():
            raise


def _has_admin_access(settings: Settings, user_id: int) -> bool:
    return settings.is_admin(user_id) or is_demo_admin(settings.db_path, user_id)


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext, settings: Settings) -> None:
    """Handle /start command and reset active FSM flow."""
    await state.clear()
    user_id = message.from_user.id if message.from_user else 0
    first_name = message.from_user.first_name if message.from_user else None
    admin_active = _has_admin_access(settings, user_id)
    await message.answer(
        _welcome_text(settings.bot_name, first_name),
        reply_markup=main_menu_kb(is_admin_active=admin_active),
    )


@router.callback_query(F.data == "menu:home")
async def cb_menu_home(callback: CallbackQuery, state: FSMContext, settings: Settings) -> None:
    """Return to main menu."""
    await state.clear()
    user_id = callback.from_user.id
    admin_active = _has_admin_access(settings, user_id)
    await _safe_edit(
        callback,
        _welcome_text(settings.bot_name, callback.from_user.first_name),
        main_menu_kb(is_admin_active=admin_active),
    )
    await callback.answer()


@router.callback_query(F.data == "menu:cases")
async def cb_menu_cases(callback: CallbackQuery) -> None:
    """Show Services & Cases screen."""
    await _safe_edit(callback, _cases_text(), cases_kb())
    await callback.answer()


@router.callback_query(F.data == "menu:calc")
async def cb_menu_calc(callback: CallbackQuery, state: FSMContext, settings: Settings) -> None:
    """Open Interactive Cost Calculator."""
    data = await state.get_data()
    selected = tuple(data.get("calc_options", ()))
    await _safe_edit(
        callback,
        render_calculator_message(selected, settings.currency),
        calculator_kb(selected),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("calc:toggle:"))
async def cb_calc_toggle(callback: CallbackQuery, state: FSMContext, settings: Settings) -> None:
    """Toggle a module inside the calculator and recalculate price/deadline."""
    assert callback.data is not None
    option_key = callback.data.split(":", maxsplit=2)[2]
    data = await state.get_data()
    current = tuple(data.get("calc_options", ()))
    updated = toggle_option(current, option_key)
    await state.update_data(calc_options=list(updated))

    await _safe_edit(
        callback,
        render_calculator_message(updated, settings.currency),
        calculator_kb(updated),
    )
    await callback.answer("Расчёт обновлён")


@router.callback_query(F.data == "calc:reset")
async def cb_calc_reset(callback: CallbackQuery, state: FSMContext, settings: Settings) -> None:
    """Reset calculator toggles to base package."""
    await state.update_data(calc_options=[])
    await _safe_edit(
        callback,
        render_calculator_message((), settings.currency),
        calculator_kb(()),
    )
    await callback.answer("Опции сброшены")


async def _begin_order_fsm(
    callback: CallbackQuery,
    state: FSMContext,
    settings: Settings,
    keep_calc: bool,
) -> None:
    data = await state.get_data()
    selected = tuple(data.get("calc_options", ())) if keep_calc else ()
    estimate = calculate_estimate(selected)
    await state.set_state(OrderForm.name)
    await state.update_data(
        calc_options=list(estimate.selected_keys),
        budget_estimate=estimate.total_price,
        deadline_label=estimate.deadline_label,
    )

    calc_banner = ""
    if keep_calc:
        calc_banner = (
            f"📌 <b>Выбранная комплектация:</b> {html.escape(estimate.summary_line(settings.currency))}\n\n"
        )

    text = (
        "📝 <b>Оформление заявки — Шаг 1 из 3</b>\n\n"
        f"{calc_banner}"
        "Как к вам обращаться? Напишите ваше <b>имя</b>:"
    )
    if callback.message:
        await callback.message.edit_text(text, reply_markup=fsm_cancel_kb())
    await callback.answer()


@router.callback_query(F.data == "order:start")
async def cb_order_start(callback: CallbackQuery, state: FSMContext, settings: Settings) -> None:
    """Start 3-step FSM order without pre-selected calculator options."""
    await _begin_order_fsm(callback, state, settings, keep_calc=False)


@router.callback_query(F.data == "order:from_calc")
async def cb_order_from_calc(callback: CallbackQuery, state: FSMContext, settings: Settings) -> None:
    """Start 3-step FSM order carrying over calculator selection."""
    await _begin_order_fsm(callback, state, settings, keep_calc=True)


@router.callback_query(F.data == "order:cancel")
async def cb_order_cancel(callback: CallbackQuery, state: FSMContext, settings: Settings) -> None:
    """Cancel FSM and return to main menu."""
    await state.clear()
    admin_active = _has_admin_access(settings, callback.from_user.id)
    await _safe_edit(
        callback,
        "❌ Оформление заявки отменено.\n\n" + _welcome_text(settings.bot_name, callback.from_user.first_name),
        main_menu_kb(is_admin_active=admin_active),
    )
    await callback.answer("Отменено")


@router.message(OrderForm.name)
async def fsm_step_name(message: Message, state: FSMContext) -> None:
    """Step 1: validate and store client name, ask for contact."""
    ok, result = validate_name(message.text or "")
    if not ok:
        await message.answer(f"⚠️ {result}\nПопробуйте ещё раз:", reply_markup=fsm_cancel_kb())
        return

    await state.update_data(client_name=result)
    await state.set_state(OrderForm.contact)

    username = message.from_user.username if message.from_user else None
    await message.answer(
        "📞 <b>Шаг 2 из 3 — Контакт для связи</b>\n\n"
        "Укажите <code>@username</code>, телефон или email (или нажмите кнопку ниже):",
        reply_markup=fsm_cancel_kb(allow_use_username=bool(username), username=username),
    )


@router.callback_query(OrderForm.contact, F.data == "order:use_tg_username")
async def fsm_use_tg_username(callback: CallbackQuery, state: FSMContext) -> None:
    """Shortcut button to fill Telegram @username on Step 2."""
    username = callback.from_user.username
    if not username:
        await callback.answer("У вашего профиля не задан @username", show_alert=True)
        return

    ok, result = validate_contact(f"@{username}")
    if not ok:
        await callback.answer(result, show_alert=True)
        return

    await state.update_data(contact=result)
    await state.set_state(OrderForm.description)
    if callback.message:
        await callback.message.edit_text(
            f"✅ Контакт сохранён: <code>@{html.escape(username)}</code>\n\n"
            "✍️ <b>Шаг 3 из 3 — Описание задачи</b>\n\n"
            "Кратко опишите, какого бота нужно сделать (функции, интеграции, сроки):",
            reply_markup=fsm_cancel_kb(),
        )
    await callback.answer()


@router.message(OrderForm.contact)
async def fsm_step_contact(message: Message, state: FSMContext) -> None:
    """Step 2: validate contact and move to description step."""
    ok, result = validate_contact(message.text or "")
    if not ok:
        username = message.from_user.username if message.from_user else None
        await message.answer(
            f"⚠️ {result}",
            reply_markup=fsm_cancel_kb(allow_use_username=bool(username), username=username),
        )
        return

    await state.update_data(contact=result)
    await state.set_state(OrderForm.description)
    await message.answer(
        "✍️ <b>Шаг 3 из 3 — Описание задачи</b>\n\n"
        "Кратко опишите, какого бота нужно сделать (функции, интеграции, сроки):",
        reply_markup=fsm_cancel_kb(),
    )


@router.message(OrderForm.description)
async def fsm_step_description(
    message: Message,
    state: FSMContext,
    settings: Settings,
    bot: Bot,
) -> None:
    """Step 3: validate description, persist order in SQLite, and notify admins."""
    ok, result = validate_description(message.text or "")
    if not ok:
        await message.answer(f"⚠️ {result}", reply_markup=fsm_cancel_kb())
        return

    data = await state.get_data()
    selected = tuple(data.get("calc_options", ()))
    estimate = calculate_estimate(selected)
    user = message.from_user
    user_id = user.id if user else 0
    username = user.username if user else None

    order = create_order(
        settings.db_path,
        user_id=user_id,
        username=username,
        client_name=data["client_name"],
        contact=data["contact"],
        task_description=result,
        budget_estimate=estimate.total_price,
        deadline_label=estimate.deadline_label,
        options=estimate.selected_keys,
    )
    await state.clear()

    admin_active = _has_admin_access(settings, user_id)
    confirm_text = (
        f"🎉 <b>Заявка #{order.id} успешно оформлена!</b>\n\n"
        f"• <b>Статус:</b> {STATUS_BADGES.get(order.status, order.status)}\n"
        f"• <b>Имя:</b> {html.escape(order.client_name)}\n"
        f"• <b>Контакт:</b> <code>{html.escape(order.contact)}</code>\n"
        f"• <b>Оценка:</b> {format_price(order.budget_estimate, settings.currency)} ({html.escape(order.deadline_label)})\n"
        f"• <b>Задача:</b> {html.escape(order.task_description)}\n\n"
        "Вы можете отслеживать смену статуса в разделе <b>«Мои заявки»</b> "
        "или протестировать обработку в <b>«Админ-режиме»</b>."
    )
    await message.answer(
        confirm_text,
        reply_markup=main_menu_kb(is_admin_active=admin_active),
    )

    # Notify configured static admins (best effort, never fails client flow)
    if settings.admin_ids:
        notify_text = (
            f"🔔 <b>Новая заявка #{order.id}</b>\n"
            f"👤 {html.escape(order.client_name)} ({html.escape(order.contact)})\n"
            f"💰 {format_price(order.budget_estimate, settings.currency)} • {html.escape(order.deadline_label)}\n"
            f"📝 {html.escape(order.task_description)}"
        )
        for admin_id in settings.admin_ids:
            try:
                await bot.send_message(admin_id, notify_text)
            except Exception:
                continue


@router.callback_query(F.data == "menu:my_orders")
async def cb_my_orders(callback: CallbackQuery, settings: Settings) -> None:
    """Show real-time statuses of the current user's orders."""
    orders = get_user_orders(settings.db_path, callback.from_user.id, limit=8)
    if not orders:
        text = (
            "📋 <b>Мои заявки</b>\n\n"
            "У вас пока нет оформленных заявок.\n"
            "Нажмите <b>«Новая заявка»</b> или соберите конфигурацию в калькуляторе."
        )
    else:
        lines = ["📋 <b>Мои заявки (актуальные статусы):</b>", ""]
        for order in orders:
            badge = STATUS_BADGES.get(order.status, order.status)
            lines.append(
                f"<b>#{order.id}</b> • {badge}\n"
                f"💰 {format_price(order.budget_estimate, settings.currency)} ({html.escape(order.deadline_label)})\n"
                f"<i>{html.escape(order.task_description[:90])}</i>"
            )
            lines.append("")
        text = "\n".join(lines).strip()

    await _safe_edit(callback, text, my_orders_kb())
    await callback.answer()
