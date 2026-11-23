"""Unit tests for ClientFlow Demo Bot core (calculator, SQLite DB, validation, CSV)."""

from __future__ import annotations

import csv
import io
import sys
from pathlib import Path

import pytest

# Ensure demo_bot/ is importable regardless of current working directory
DEMO_BOT_DIR = Path(__file__).resolve().parent.parent
if str(DEMO_BOT_DIR) not in sys.path:
    sys.path.insert(0, str(DEMO_BOT_DIR))

from calculator import (
    BASE_BOT_HOURS,
    BASE_BOT_PRICE,
    CALCULATOR_OPTIONS,
    calculate_estimate,
    format_price,
    render_calculator_message,
    toggle_option,
)
from config import load_settings
from db import (
    ORDER_STATUSES,
    create_order,
    export_orders_csv,
    get_all_orders,
    get_order_by_id,
    get_order_stats,
    get_user_orders,
    init_db,
    is_demo_admin,
    next_order_status,
    set_demo_admin,
    update_order_status,
    validate_contact,
    validate_description,
    validate_name,
)


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "test_clientflow.db"
    init_db(path)
    return path


# ---------------------------------------------------------------------------
# Calculator tests
# ---------------------------------------------------------------------------


def test_calculator_base_estimate() -> None:
    est = calculate_estimate([])
    assert est.total_price == BASE_BOT_PRICE
    assert est.total_hours == BASE_BOT_HOURS
    assert est.selected_keys == ()
    assert est.is_urgent is False
    assert "1 день" in est.deadline_label


def test_calculator_toggle_and_all_options() -> None:
    keys: tuple[str, ...] = ()
    keys = toggle_option(keys, "admin")
    keys = toggle_option(keys, "payment")
    assert keys == ("admin", "payment")

    est = calculate_estimate(keys)
    assert est.total_price == BASE_BOT_PRICE + 1000 + 1500
    assert est.total_hours == 24 + 12 + 12
    assert "2 дня" in est.deadline_label

    # Toggling off removes cleanly
    keys = toggle_option(keys, "admin")
    assert keys == ("payment",)

    # Unknown keys ignored gracefully
    keys = toggle_option(keys, "unknown_flag")
    assert keys == ("payment",)


def test_calculator_urgent_mode_reduces_deadline_and_adds_fee() -> None:
    est_std = calculate_estimate(["admin", "sheets_api"])
    est_urgent = calculate_estimate(["admin", "sheets_api", "urgent"])

    assert est_urgent.is_urgent is True
    assert est_urgent.total_price == est_std.total_price + 1500
    assert est_urgent.total_hours < est_std.total_hours
    assert "срочно" in est_urgent.deadline_label


def test_calculator_render_and_format() -> None:
    assert format_price(6500) == "6 500 ₽"
    msg = render_calculator_message(["admin", "payment"])
    assert "✅ <b>Админ-панель и статусы</b>" in msg
    assert "5 000 ₽" in msg
    assert str(len(CALCULATOR_OPTIONS)) or "✅" in msg


# ---------------------------------------------------------------------------
# Validation tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected_ok"),
    [
        ("Алексей", True),
        ("Анна-Мария", True),
        ("  Иван  Петров ", True),
        ("Марина К.", True),
        ("А", False),
        (" А ", False),
        ("12345", False),
        (";oasfksfks;df spodfj", False),
        ("<script>alert(1)</script>", False),
        ("A!", False),
        ("---a---", False),
        ("😀😀a", False),
        ("", False),
    ],
)
def test_validate_name(raw: str, expected_ok: bool) -> None:
    ok, _ = validate_name(raw)
    assert ok is expected_ok


@pytest.mark.parametrize(
    ("raw", "expected_ok"),
    [
        ("@alexey_biz", True),
        ("t.me/squzzer_dev", True),
        ("https://t.me/SQUZZER_CODER", True),
        ("+375 (29) 123-45-67", True),
        ("client@example.com", True),
        ("ab", False),
        ("@aaa", False),
        ("@123bad", False),
        ("-------", False),
        ("()()()()", False),
        ("https://x", False),
        ("просто текст без контакта", False),
    ],
)
def test_validate_contact(raw: str, expected_ok: bool) -> None:
    ok, _ = validate_contact(raw)
    assert ok is expected_ok


@pytest.mark.parametrize(
    ("raw", "expected_ok"),
    [
        ("Нужен бот с оплатой и выгрузкой в Google Таблицы", True),
        ("Коротко", False),
        ("...........", False),
        ("1111111111", False),
        (";;;;;;;;;;", False),
        ("   ", False),
    ],
)
def test_validate_description(raw: str, expected_ok: bool) -> None:
    ok, _ = validate_description(raw)
    assert ok is expected_ok


# ---------------------------------------------------------------------------
# SQLite CRUD, statuses, stats & CSV export tests
# ---------------------------------------------------------------------------


def test_create_and_fetch_orders(db_path: Path) -> None:
    order = create_order(
        db_path,
        user_id=101,
        username="alex_client",
        client_name="Алексей",
        contact="@alex_client",
        task_description="Нужен бот для приёма заявок и учёта в базе",
        budget_estimate=5000,
        deadline_label="2 дня",
        options=("admin", "payment"),
    )
    assert order.id == 1
    assert order.status == "Новая"
    assert order.options == ("admin", "payment")

    fetched = get_order_by_id(db_path, order.id)
    assert fetched is not None
    assert fetched.client_name == "Алексей"

    user_orders = get_user_orders(db_path, 101)
    assert len(user_orders) == 1
    assert get_user_orders(db_path, 999) == []


def test_create_order_rejects_invalid_payload(db_path: Path) -> None:
    with pytest.raises(ValueError):
        create_order(
            db_path,
            user_id=101,
            username=None,
            client_name="А",
            contact="@valid_user",
            task_description="Достаточно длинное описание задачи",
            budget_estimate=2500,
            deadline_label="1 день (24 ч)",
        )


def test_order_status_cycle_and_stats(db_path: Path) -> None:
    o1 = create_order(
        db_path,
        user_id=1,
        username="u1",
        client_name="Иван",
        contact="@ivan_dev",
        task_description="Бот-каталог с приёмом оплат и уведомлениями",
        budget_estimate=4000,
        deadline_label="1.5 дня",
    )
    o2 = create_order(
        db_path,
        user_id=2,
        username="u2",
        client_name="Мария",
        contact="+7 999 123-45-67",
        task_description="Бот для записи клиентов в салон красоты",
        budget_estimate=3500,
        deadline_label="1.5 дня",
    )

    assert next_order_status("Новая") == "В работе"
    assert next_order_status("В работе") == "Готово"
    assert next_order_status("Готово") == "Новая"

    updated1 = update_order_status(db_path, o1.id, ORDER_STATUSES[1])
    assert updated1 is not None and updated1.status == "В работе"

    updated2 = update_order_status(db_path, o2.id, ORDER_STATUSES[2])
    assert updated2 is not None and updated2.status == "Готово"

    with pytest.raises(ValueError):
        update_order_status(db_path, o1.id, "Отменена_неверно")

    stats = get_order_stats(db_path)
    assert stats.total_orders == 2
    assert stats.new_count == 0
    assert stats.in_progress_count == 1
    assert stats.done_count == 1
    assert stats.total_pipeline_amount == 7500
    assert len(get_all_orders(db_path)) == 2


def test_demo_admin_toggle(db_path: Path) -> None:
    assert is_demo_admin(db_path, 555) is False
    set_demo_admin(db_path, 555, True)
    assert is_demo_admin(db_path, 555) is True
    set_demo_admin(db_path, 555, False)
    assert is_demo_admin(db_path, 555) is False


def test_export_orders_csv_formatting(db_path: Path) -> None:
    create_order(
        db_path,
        user_id=42,
        username="biz_lead",
        client_name="Дмитрий",
        contact="@biz_lead",
        task_description='=CMD("calc") Нужен бот: "воронка, оплата, CRM"',
        budget_estimate=6500,
        deadline_label="2.5 дня",
        options=("admin", "payment", "sheets_api"),
    )

    csv_text = export_orders_csv(db_path)
    assert csv_text.startswith("\ufeff")
    clean_csv = csv_text.lstrip("\ufeff")
    rows = list(csv.reader(io.StringIO(clean_csv)))
    assert len(rows) == 2
    assert rows[0][0] == "ID"
    assert rows[0][3] == "Имя клиента"
    assert rows[1][3] == "Дмитрий"
    assert rows[1][4] == "'@biz_lead"
    assert rows[1][6] == "6500"
    assert rows[1][5].startswith("'=CMD")
    assert "admin, payment, sheets_api" in rows[1][8]


def test_load_settings_parses_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "BOT_TOKEN=test_tok_123\nADMIN_IDS=111, 222,bad, 111\nDB_PATH=custom.db\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("BOT_TOKEN", raising=False)
    monkeypatch.delenv("ADMIN_IDS", raising=False)
    monkeypatch.delenv("DB_PATH", raising=False)

    settings = load_settings(env_file)
    assert settings.bot_token == "test_tok_123"
    assert settings.admin_ids == (111, 222)
    assert settings.is_admin(222) is True
    assert settings.is_admin(333) is False
    assert settings.db_path.name == "custom.db"
