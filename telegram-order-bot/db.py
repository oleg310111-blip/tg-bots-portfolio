"""SQLite persistence, input validation, and CSV export for ClientFlow Demo Bot."""

from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

ORDER_STATUSES: tuple[str, ...] = ("Новая", "В работе", "Готово")

STATUS_BADGES: dict[str, str] = {
    "Новая": "🆕 Новая",
    "В работе": "⚙️ В работе",
    "Готово": "✅ Готово",
}

_NAME_ALLOWED_RE = re.compile(r"^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s\-.'’]{1,59}$")
_NAME_BAD_REPEAT_RE = re.compile(r"(?:--|\.\.|''|’’)")
_LETTER_RE = re.compile(r"[A-Za-zА-Яа-яЁё]")
_WORD_WITH_LETTERS_RE = re.compile(r"[A-Za-zА-Яа-яЁё]{2,}")

_TG_HANDLE_RE = re.compile(r"^@[A-Za-z][A-Za-z0-9_]{4,31}$")
_TG_LINK_RE = re.compile(r"^(?:https?://)?(?:t\.me|telegram\.me)/([A-Za-z][A-Za-z0-9_]{4,31})/?$", re.I)
_PHONE_FORMAT_RE = re.compile(r"^\+?[0-9][0-9\s\-\(\)]{5,18}[0-9]$")
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,12}$")


def _csv_safe_cell(value: object) -> str:
    """Neutralize leading spreadsheet formula triggers in exported CSV cells."""
    text = str(value or "")
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


@dataclass(frozen=True)
class OrderRecord:
    """Database representation of a client bot order."""

    id: int
    user_id: int
    username: str | None
    client_name: str
    contact: str
    task_description: str
    budget_estimate: int
    deadline_label: str
    options: tuple[str, ...]
    status: str
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class OrderStats:
    """Aggregated order statistics for the admin dashboard."""

    total_orders: int
    new_count: int
    in_progress_count: int
    done_count: int
    total_pipeline_amount: int


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


@contextmanager
def get_connection(db_path: Path | str) -> Iterator[sqlite3.Connection]:
    """Yield an initialized SQLite connection with row factory and commit/close."""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=10.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON;")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: Path | str) -> None:
    """Create tables if they do not exist."""
    with get_connection(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT,
                client_name TEXT NOT NULL,
                contact TEXT NOT NULL,
                task_description TEXT NOT NULL,
                budget_estimate INTEGER NOT NULL DEFAULT 2500,
                deadline_label TEXT NOT NULL DEFAULT '1 день (24 ч)',
                options_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'Новая',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                demo_admin INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
            """
        )


def validate_name(value: str) -> tuple[bool, str]:
    """Validate client name (2..60 chars, letters/spaces/hyphens/apostrophes, >= 2 letters)."""
    cleaned = " ".join(value.strip().split())
    if len(cleaned) < 2:
        return False, "Имя слишком короткое — укажите минимум 2 буквы."
    if len(cleaned) > 60:
        return False, "Имя слишком длинное (максимум 60 символов)."
    if not _NAME_ALLOWED_RE.match(cleaned) or _NAME_BAD_REPEAT_RE.search(cleaned):
        return False, "Имя может содержать только буквы, пробелы, дефис или апостроф."
    if cleaned.endswith("-") or "- -" in cleaned:
        return False, "Имя не может заканчиваться на дефис."
    if len(_LETTER_RE.findall(cleaned)) < 2:
        return False, "Имя должно содержать минимум 2 буквы."
    return True, cleaned


def validate_contact(value: str) -> tuple[bool, str]:
    """Validate Telegram @username, t.me link, phone number (7..15 digits), or email."""
    cleaned = " ".join(value.strip().split())
    if len(cleaned) < 5:
        return False, "Контакт слишком короткий. Укажите @username, телефон или email."
    if len(cleaned) > 80:
        return False, "Контакт слишком длинный (максимум 80 символов)."

    if _TG_HANDLE_RE.match(cleaned):
        return True, cleaned

    tg_match = _TG_LINK_RE.match(cleaned)
    if tg_match:
        return True, f"@{tg_match.group(1)}"

    if _PHONE_FORMAT_RE.match(cleaned):
        digits = re.sub(r"\D", "", cleaned)
        if 7 <= len(digits) <= 15:
            return True, cleaned

    if _EMAIL_RE.match(cleaned):
        return True, cleaned

    return False, "Укажите @username (от 5 символов), t.me/ник, телефон (+375/+7...) или email."


def validate_description(value: str) -> tuple[bool, str]:
    """Validate task description (10..1000 chars, >= 5 letters and >= 2 words)."""
    cleaned = " ".join(value.strip().split())
    if len(cleaned) < 10:
        return False, "Опишите задачу чуть подробнее (минимум 10 символов)."
    if len(cleaned) > 1000:
        return False, "Описание слишком длинное (максимум 1000 символов)."
    if len(_LETTER_RE.findall(cleaned)) < 5 or len(_WORD_WITH_LETTERS_RE.findall(cleaned)) < 2:
        return False, "Опишите задачу словами (минимум 2 слова и 5 букв)."
    return True, cleaned


def _row_to_order(row: sqlite3.Row) -> OrderRecord:
    try:
        opts_raw = json.loads(row["options_json"] or "[]")
        opts = tuple(str(x) for x in opts_raw)
    except json.JSONDecodeError:
        opts = ()
    return OrderRecord(
        id=int(row["id"]),
        user_id=int(row["user_id"]),
        username=row["username"],
        client_name=row["client_name"],
        contact=row["contact"],
        task_description=row["task_description"],
        budget_estimate=int(row["budget_estimate"]),
        deadline_label=row["deadline_label"],
        options=opts,
        status=row["status"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def create_order(
    db_path: Path | str,
    *,
    user_id: int,
    username: str | None,
    client_name: str,
    contact: str,
    task_description: str,
    budget_estimate: int,
    deadline_label: str,
    options: tuple[str, ...] | list[str] = (),
) -> OrderRecord:
    """Validate and insert a new order into SQLite."""
    ok_n, clean_name = validate_name(client_name)
    if not ok_n:
        raise ValueError(clean_name)
    ok_c, clean_contact = validate_contact(contact)
    if not ok_c:
        raise ValueError(clean_contact)
    ok_d, clean_desc = validate_description(task_description)
    if not ok_d:
        raise ValueError(clean_desc)

    now = _utc_now_iso()
    clean_username = username.lstrip("@").strip() if username else None
    options_json = json.dumps(list(options), ensure_ascii=False)

    with get_connection(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO orders (
                user_id, username, client_name, contact, task_description,
                budget_estimate, deadline_label, options_json, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Новая', ?, ?)
            """,
            (
                user_id,
                clean_username,
                clean_name,
                clean_contact,
                clean_desc,
                int(budget_estimate),
                deadline_label,
                options_json,
                now,
                now,
            ),
        )
        order_id = cur.lastrowid
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        assert row is not None
        return _row_to_order(row)


def get_order_by_id(db_path: Path | str, order_id: int) -> OrderRecord | None:
    """Fetch a single order by primary key."""
    with get_connection(db_path) as conn:
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        return _row_to_order(row) if row else None


def get_user_orders(db_path: Path | str, user_id: int, limit: int = 10) -> list[OrderRecord]:
    """Return latest orders created by a specific Telegram user."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [_row_to_order(r) for r in rows]


def get_all_orders(db_path: Path | str, limit: int = 20) -> list[OrderRecord]:
    """Return latest orders across all users."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM orders ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [_row_to_order(r) for r in rows]


def next_order_status(current_status: str) -> str:
    """Cycle status: Новая -> В работе -> Готово -> Новая."""
    if current_status not in ORDER_STATUSES:
        return ORDER_STATUSES[0]
    idx = ORDER_STATUSES.index(current_status)
    return ORDER_STATUSES[(idx + 1) % len(ORDER_STATUSES)]


def update_order_status(db_path: Path | str, order_id: int, new_status: str) -> OrderRecord | None:
    """Update order status after verifying it belongs to ORDER_STATUSES."""
    if new_status not in ORDER_STATUSES:
        raise ValueError(f"Недопустимый статус: {new_status}")

    now = _utc_now_iso()
    with get_connection(db_path) as conn:
        cur = conn.execute(
            "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?",
            (new_status, now, order_id),
        )
        if cur.rowcount == 0:
            return None
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        return _row_to_order(row) if row else None


def get_order_stats(db_path: Path | str) -> OrderStats:
    """Compute order counts by status and total pipeline sum."""
    with get_connection(db_path) as conn:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS total_orders,
                COALESCE(SUM(CASE WHEN status = 'Новая' THEN 1 ELSE 0 END), 0) AS new_count,
                COALESCE(SUM(CASE WHEN status = 'В работе' THEN 1 ELSE 0 END), 0) AS in_progress_count,
                COALESCE(SUM(CASE WHEN status = 'Готово' THEN 1 ELSE 0 END), 0) AS done_count,
                COALESCE(SUM(budget_estimate), 0) AS total_pipeline_amount
            FROM orders
            """
        ).fetchone()
        assert row is not None
        return OrderStats(
            total_orders=int(row["total_orders"]),
            new_count=int(row["new_count"]),
            in_progress_count=int(row["in_progress_count"]),
            done_count=int(row["done_count"]),
            total_pipeline_amount=int(row["total_pipeline_amount"]),
        )


def is_demo_admin(db_path: Path | str, user_id: int) -> bool:
    """Return True if user enabled Demo Admin mode."""
    with get_connection(db_path) as conn:
        row = conn.execute(
            "SELECT demo_admin FROM user_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return bool(row and row["demo_admin"])


def set_demo_admin(db_path: Path | str, user_id: int, enabled: bool) -> bool:
    """Enable or disable Demo Admin mode for a user."""
    now = _utc_now_iso()
    val = 1 if enabled else 0
    with get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO user_settings (user_id, demo_admin, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                demo_admin = excluded.demo_admin,
                updated_at = excluded.updated_at
            """,
            (user_id, val, now),
        )
    return enabled


def export_orders_csv(db_path: Path | str) -> str:
    """Export all orders to a UTF-8 with BOM CSV string for Excel & Google Sheets."""
    with get_connection(db_path) as conn:
        rows = conn.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()

    buffer = io.StringIO()
    buffer.write("\ufeff")  # UTF-8 BOM for proper Cyrillic opening in Excel
    writer = csv.writer(buffer, delimiter=",", quotechar='"', quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    writer.writerow(
        [
            "ID",
            "User ID",
            "Username",
            "Имя клиента",
            "Контакт",
            "Описание задачи",
            "Оценка бюджета (₽)",
            "Срок",
            "Опции",
            "Статус",
            "Создана (UTC)",
            "Обновлена (UTC)",
        ]
    )

    for row in rows:
        order = _row_to_order(row)
        writer.writerow(
            [
                order.id,
                order.user_id,
                _csv_safe_cell(f"@{order.username}" if order.username else ""),
                _csv_safe_cell(order.client_name),
                _csv_safe_cell(order.contact),
                _csv_safe_cell(order.task_description),
                order.budget_estimate,
                _csv_safe_cell(order.deadline_label),
                _csv_safe_cell(", ".join(order.options)),
                _csv_safe_cell(order.status),
                order.created_at,
                order.updated_at,
            ]
        )

    return buffer.getvalue()
