"""Config package — public surface.

Usage:
    from src.infrastructure.config import Settings, get_settings, clear_settings_cache

Backwards compat:
    ``import src.infrastructure.config`` previously exposed ``settings`` eager instance
    and ``get_settings``. We keep ``get_settings`` and re-export ``Settings`` / helpers.
    The old ``settings`` global is deprecated — use ``get_settings()`` (DI-friendly).
"""

from __future__ import annotations

from src.infrastructure.config.aws import load_from_aws
from src.infrastructure.config.provider import clear_settings_cache, get_settings, resolve_env_type
from src.infrastructure.config.settings import Settings, parse_inference_providers

__all__ = [
    "Settings",
    "get_settings",
    "clear_settings_cache",
    "resolve_env_type",
    "parse_inference_providers",
    "load_from_aws",
]


# Backwards-compat: some modules imported ``from src.infrastructure.config import settings``.
# We provide a lazy proxy so old code that accessed ``settings.API_KEY`` at import time
# still works but goes through ``get_settings()``. New code should inject ``Settings`` via ctor.
class _LazySettingsProxy:
    def __getattr__(self, name: str):  # type: ignore[no-untyped-def]
        return getattr(get_settings(), name)

    def __repr__(self) -> str:
        return f"<LazySettingsProxy -> {get_settings()!r}>"


# Deprecated global — prefer ``get_settings()``.
settings = _LazySettingsProxy()  # type: ignore[assignment]
