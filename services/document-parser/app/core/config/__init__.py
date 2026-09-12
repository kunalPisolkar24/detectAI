"""Config package — public surface.

Usage:
    from app.core.config import Settings, get_settings, clear_settings_cache

Backwards compat:
    ``from app.core.config import settings`` previously exposed an eager
    ``Settings()`` singleton. We keep a lazy proxy so old code that accessed
    ``settings.MAX_UPLOAD_SIZE_BYTES`` at import still works via
    ``get_settings()``. New code should use ``get_settings()`` or DI.
"""

from __future__ import annotations

from app.core.config.aws import load_from_aws
from app.core.config.provider import clear_settings_cache, get_settings, resolve_env_type
from app.core.config.settings import Settings, parse_mime_types

__all__ = [
    "Settings",
    "get_settings",
    "clear_settings_cache",
    "resolve_env_type",
    "parse_mime_types",
    "load_from_aws",
]


class _LazySettingsProxy:
    def __getattr__(self, name: str):  # type: ignore[no-untyped-def]
        return getattr(get_settings(), name)

    def __repr__(self) -> str:
        return f"<LazySettingsProxy -> {get_settings()!r}>"


# Deprecated global — prefer ``get_settings()``.
settings = _LazySettingsProxy()  # type: ignore[assignment]
