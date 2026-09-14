"""Backward-compat shim — prefer importing from infrastructure.config."""

from __future__ import annotations

from src.infrastructure.config.provider import clear_settings_cache, get_settings
from src.infrastructure.config.settings import Settings

# Legacy global — triggers load on import; new code should call get_settings().
try:
    settings = get_settings()
except Exception:
    # allow import without env in tests/lint; caller will call get_settings() explicitly
    settings = None  # type: ignore[assignment]

__all__ = ["Settings", "get_settings", "clear_settings_cache", "settings"]
