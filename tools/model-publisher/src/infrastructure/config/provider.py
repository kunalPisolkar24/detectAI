"""Lazy, cached settings provider — mirrors services/inference/provider.py."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from src.infrastructure.config.settings import Settings


def _load_dotenv_if_present() -> None:
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        return
    if os.path.exists(".env"):
        load_dotenv(override=False)
    else:
        env_file = os.getenv("ENV_FILE")
        if env_file and os.path.exists(env_file):
            load_dotenv(dotenv_path=env_file, override=False)


def _build_settings() -> Settings:
    _load_dotenv_if_present()
    # filter empty strings so Settings defaults / validators apply correctly
    merged: dict[str, Any] = {k: v for k, v in os.environ.items() if v is not None and v != ""}
    return Settings(**merged)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings singleton. Call clear_settings_cache() in tests."""
    return _build_settings()


def clear_settings_cache() -> None:
    get_settings.cache_clear()
