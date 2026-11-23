"""Handlers package for ClientFlow Demo Bot."""

from handlers.admin import router as admin_router
from handlers.client import router as client_router

__all__ = ["client_router", "admin_router"]
