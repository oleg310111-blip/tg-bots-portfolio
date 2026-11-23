"""Entry point for ClientFlow Demo Bot (aiogram 3.x + SQLite)."""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage

from config import load_settings
from db import init_db
from handlers import admin_router, client_router


async def run_bot() -> None:
    """Initialize database, configure dispatcher, and start polling."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    settings = load_settings()
    if not settings.bot_token:
        raise RuntimeError(
            "BOT_TOKEN is not set. Copy .env.example to .env and specify your Telegram Bot Token."
        )

    init_db(settings.db_path)

    bot = Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dp = Dispatcher(storage=MemoryStorage())
    dp["settings"] = settings

    dp.include_router(client_router)
    dp.include_router(admin_router)

    logging.info("Starting %s (DB: %s)", settings.bot_name, settings.db_path)
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)


def main() -> None:
    """Synchronous CLI wrapper."""
    try:
        asyncio.run(run_bot())
    except (KeyboardInterrupt, SystemExit):
        logging.info("Bot stopped.")


if __name__ == "__main__":
    main()
