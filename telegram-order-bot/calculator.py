"""Interactive pricing & delivery timeline calculator for Telegram bots."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class CalculatorOption:
    """Single selectable module in the interactive cost calculator."""

    key: str
    title: str
    short_title: str
    price: int
    extra_hours: int
    description: str


BASE_BOT_PRICE = 2500
BASE_BOT_HOURS = 24  # 1 day standard delivery
URGENT_DISCOUNT_HOURS = 12  # Urgent launch delivers in 6-12h

CALCULATOR_OPTIONS: tuple[CalculatorOption, ...] = (
    CalculatorOption(
        key="admin",
        title="Админ-панель и статусы",
        short_title="Админка",
        price=1000,
        extra_hours=12,
        description="Смена статусов заявок, статистика и управление из Telegram",
    ),
    CalculatorOption(
        key="payment",
        title="Приём оплат (Карта / ЮKassa / Crypto)",
        short_title="Оплата",
        price=1500,
        extra_hours=12,
        description="Выставление счетов, проверка оплаты и автовыдача доступа",
    ),
    CalculatorOption(
        key="sheets_api",
        title="Интеграция Google Sheets / API",
        short_title="Google Sheets / API",
        price=1500,
        extra_hours=24,
        description="Синхронизация заявок с таблицами, CRM или внешним REST API",
    ),
    CalculatorOption(
        key="crm_db",
        title="База клиентов и рассылка",
        short_title="База клиентов",
        price=1200,
        extra_hours=12,
        description="Сегментация пользователей, история обращений и триггер-рассылки",
    ),
    CalculatorOption(
        key="urgent",
        title="Срочный запуск (6–12 ч)",
        short_title="Срочный запуск",
        price=1500,
        extra_hours=0,
        description="Приоритетная сборка и запуск MVP в течение 6–12 часов",
    ),
)

OPTIONS_BY_KEY: dict[str, CalculatorOption] = {opt.key: opt for opt in CALCULATOR_OPTIONS}


@dataclass(frozen=True)
class EstimateResult:
    """Computed price, turnaround hours/label, and selected option objects."""

    selected_keys: tuple[str, ...]
    selected_options: tuple[CalculatorOption, ...]
    total_price: int
    total_hours: int
    deadline_label: str
    is_urgent: bool

    def summary_line(self, currency: str = "₽") -> str:
        """Compact single-line summary for order cards and DB storage."""
        modules = ", ".join(opt.short_title for opt in self.selected_options) or "Базовый бот"
        return f"{format_price(self.total_price, currency)} ({self.deadline_label}) • {modules}"


def format_price(amount: int, currency: str = "₽") -> str:
    """Format integer price with narrow/non-breaking space thousands separator."""
    formatted = f"{amount:,}".replace(",", " ")
    return f"{formatted} {currency}"


def normalize_option_keys(keys: Iterable[str]) -> tuple[str, ...]:
    """Filter unknown keys and preserve canonical CALCULATOR_OPTIONS order."""
    raw_set = {k.strip() for k in keys if k and k.strip() in OPTIONS_BY_KEY}
    return tuple(opt.key for opt in CALCULATOR_OPTIONS if opt.key in raw_set)


def toggle_option(selected_keys: Iterable[str], key: str) -> tuple[str, ...]:
    """Toggle an option key on/off and return normalized tuple."""
    if key not in OPTIONS_BY_KEY:
        return normalize_option_keys(selected_keys)
    current = set(normalize_option_keys(selected_keys))
    if key in current:
        current.remove(key)
    else:
        current.add(key)
    return normalize_option_keys(current)


def _format_deadline_label(total_hours: int, is_urgent: bool) -> str:
    if is_urgent:
        if total_hours <= 12:
            return "6–12 часов (срочно)"
        return f"до {total_hours} ч (срочно)"

    days = total_hours / 24
    if days <= 1.0:
        return "1 день (24 ч)"
    if days.is_integer():
        d_int = int(days)
        word = "дня" if d_int in (2, 3, 4) else "дней"
        return f"{d_int} {word}"
    return f"{days:.1f} дня"


def calculate_estimate(selected_keys: Iterable[str]) -> EstimateResult:
    """Calculate total price and turnaround for selected option keys."""
    normalized = normalize_option_keys(selected_keys)
    selected_opts = tuple(OPTIONS_BY_KEY[k] for k in normalized)

    total_price = BASE_BOT_PRICE + sum(opt.price for opt in selected_opts)
    is_urgent = "urgent" in normalized

    raw_hours = BASE_BOT_HOURS + sum(opt.extra_hours for opt in selected_opts)
    if is_urgent:
        # Urgent queue cuts standard build time roughly in half (minimum 8 hours, max 24h for full stack)
        total_hours = max(8, min(24, raw_hours // 3))
    else:
        total_hours = raw_hours

    deadline_label = _format_deadline_label(total_hours, is_urgent)
    return EstimateResult(
        selected_keys=normalized,
        selected_options=selected_opts,
        total_price=total_price,
        total_hours=total_hours,
        deadline_label=deadline_label,
        is_urgent=is_urgent,
    )


def render_calculator_message(selected_keys: Iterable[str], currency: str = "₽") -> str:
    """Render Telegram HTML message for the interactive calculator screen."""
    estimate = calculate_estimate(selected_keys)
    lines = [
        "🧮 <b>Интерактивный калькулятор стоимости</b>",
        "",
        "Отметьте нужные модули — цена и срок пересчитаются мгновенно:",
        f"• <b>База (меню + заявки + уведомления):</b> {format_price(BASE_BOT_PRICE, currency)}",
        "",
    ]

    selected_set = set(estimate.selected_keys)
    for opt in CALCULATOR_OPTIONS:
        mark = "✅" if opt.key in selected_set else "⬜"
        lines.append(f"{mark} <b>{opt.title}</b> — +{format_price(opt.price, currency)}")

    lines.extend(
        [
            "",
            "━━━━━━━━━━━━━━━━━━━━",
            f"💰 <b>Примерная стоимость:</b> <code>~ {format_price(estimate.total_price, currency)}</code>",
            f"⏱ <b>Примерный срок запуска:</b> <code>~ {estimate.deadline_label}</code>",
            "━━━━━━━━━━━━━━━━━━━━",
            "<i>Цена и сроки примерные — точная оценка фиксируется после изучения ТЗ. После расчёта можно сразу оформить заявку с этими параметрами.</i>",
        ]
    )
    return "\n".join(lines)
