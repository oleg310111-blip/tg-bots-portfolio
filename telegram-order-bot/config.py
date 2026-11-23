"""Configuration loader for ClientFlow Demo Bot."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Settings:
    """Application settings loaded from environment variables."""

    bot_token: str
    admin_ids: tuple[int, ...]
    db_path: Path
    bot_name: str = "ClientFlow Demo Bot"
    currency: str = "₽"

    def is_admin(self, user_id: int) -> bool:
        """Return True if user_id is listed in static ADMIN_IDS."""
        return user_id in self.admin_ids


def _parse_admin_ids(raw: str) -> tuple[int, ...]:
    ids: list[int] = []
    for chunk in raw.split(","):
        cleaned = chunk.strip()
        if not cleaned:
            continue
        try:
            ids.append(int(cleaned))
        except ValueError:
            continue
    return tuple(dict.fromkeys(ids))


def load_settings(env_path: Path | None = None) -> Settings:
    """Load settings from .env and environment variables."""
    load_dotenv(dotenv_path=env_path or (BASE_DIR / ".env"))

    bot_token = os.getenv("BOT_TOKEN", "").strip()
    admin_ids = _parse_admin_ids(os.getenv("ADMIN_IDS", ""))
    raw_db = os.getenv("DB_PATH", str(BASE_DIR / "clientflow_demo.db")).strip()
    db_path = Path(raw_db)
    if not db_path.is_absolute():
        db_path = BASE_DIR / db_path

    bot_name = os.getenv("BOT_NAME", "ClientFlow Demo Bot").strip() or "ClientFlow Demo Bot"
    currency = os.getenv("CURRENCY", "₽").strip() or "₽"

    return Settings(
        bot_token=bot_token,
        admin_ids=admin_ids,
        db_path=db_path,
        bot_name=bot_name,
        currency=currency,
    )
