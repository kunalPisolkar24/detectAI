"""Dev / prod config provider — mirrors inference/gateway/workers ChainProvider.

Responsibilities (single entry point: ``get_settings()``):
- Resolve ``ENV_TYPE`` (canonical) with deprecated ``CONFIG_SOURCE`` mapping.
- ``dev``: load ``.env`` / ``ENV_FILE`` via ``python-dotenv``, apply dev defaults.
- ``prod``: load Secrets Manager + SSM via ``aws.load_from_aws``, apply non-secret overrides, strict validation.
- Cache result (``lru_cache``) and expose ``clear_settings_cache()`` for tests.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

try:
    import structlog  # type: ignore

    _has_structlog = True
except ImportError:
    _has_structlog = False
    structlog = None  # type: ignore

from app.core.config.aws import load_from_aws
from app.core.config.settings import Settings

_logger = logging.getLogger(__name__)


def _log_info(event: str, **kwargs: object) -> None:
    if _has_structlog:
        try:
            structlog.get_logger().info(event, **kwargs)  # type: ignore
            return
        except Exception:
            pass
    _logger.info("%s %s", event, kwargs)


def _log_warning(event: str, **kwargs: object) -> None:
    if _has_structlog:
        try:
            structlog.get_logger().warning(event, **kwargs)  # type: ignore
            return
        except Exception:
            pass
    _logger.warning("%s %s", event, kwargs)


_DEV_DEFAULTS: dict[str, str] = {
    "OTEL_SERVICE_NAME": "document-parser",
    "AWS_REGION": "ap-south-1",
}

# Non-secret keys that may be overridden via env in prod (secrets never).
_PROD_NON_SECRET_OVERRIDES = (
    "PORT",
    "WORKER_THREADS",
    "MAX_UPLOAD_SIZE_BYTES",
    "MAX_TEXT_LENGTH",
    "MAX_PDF_PAGES",
    "MAX_DOCX_UNCOMPRESSED_BYTES",
    "EXTRACTION_TIMEOUT_SECONDS",
    "READINESS_MAX_QUEUE_DEPTH",
    "HEADER_FOOTER_MARGIN_PT",
    "HEADER_REPETITION_RATIO",
    "ALLOWED_MIME_TYPES",
    "LOG_LEVEL",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_SERVICE_NAME",
    "OTEL_SERVICE_VERSION",
    "SERVICE_VERSION",
    "AWS_REGION",
    "AWS_ENDPOINT_URL",
    "SSM_PREFIX",
    "SSM_ENABLED",
    "DOCUMENT_PARSER_SECRETS_NAME",
)


def _env_or(key: str, fallback: str) -> str:
    v = os.getenv(key)
    return v if v is not None and v != "" else fallback


def resolve_env_type() -> str:
    """Resolve ``ENV_TYPE`` with legacy fallbacks (matches gateway/workers)."""
    raw = os.getenv("ENV_TYPE")
    if raw is not None and raw.strip() != "":
        return raw.strip().lower()

    for legacy_key in ("CONFIG_SOURCE",):
        legacy = os.getenv(legacy_key)
        if legacy is not None and legacy.strip() != "":
            v = legacy.strip().lower()
            _log_warning(
                "deprecated_env_var_used",
                legacy_key=legacy_key,
                value=v,
                hint="Use ENV_TYPE=dev|prod",
            )
            if v in {"aws", "prod", "production"}:
                return "prod"
            if v in {"env", "dev", "development", "test"}:
                return "dev"
            return v

    node_env = os.getenv("NODE_ENV")
    if node_env is not None:
        n = node_env.strip().lower()
        if n == "production":
            return "prod"
        if n == "test":
            return "dev"

    return "dev"


def _apply_dev_defaults(cfg: dict[str, str]) -> None:
    for k, v in _DEV_DEFAULTS.items():
        if not cfg.get(k):
            cfg[k] = _env_or(k, v)
    if not cfg.get("AWS_REGION"):
        cfg["AWS_REGION"] = _env_or("AWS_REGION", "ap-south-1")


def _load_prod_non_secret_overrides(cfg: dict[str, str]) -> None:
    """Fill ``cfg`` from ``process.env`` only for non-secret keys, if not already set via AWS."""
    for key in _PROD_NON_SECRET_OVERRIDES:
        v = os.getenv(key)
        if v is not None and v != "" and not cfg.get(key):
            cfg[key] = v
    if not cfg.get("AWS_REGION"):
        cfg["AWS_REGION"] = _env_or("AWS_REGION", "ap-south-1")


def _validate_prod_strict(settings: Settings) -> None:
    """Fail-fast for common prod misconfigurations."""
    if not settings.AWS_REGION:
        raise ValueError("ENV_TYPE=prod requires AWS_REGION")
    # If an API-key-like value ever appears via secret, reject dev markers.
    # Document-parser currently has no required secret, so only validate when present.
    # Keep future-proof: check OTEL endpoint not pointing to dev defaults? Not needed.
    # Example: reject obvious dev OTEL endpoints? No.
    # Check for dev markers in any secret-derived field if it exists
    # (currently none mandatory, so this is a placeholder for future INTERNAL_API_KEY etc.)
    pass


def _load_dotenv_for_dev() -> None:
    """Load ``.env`` / ``ENV_FILE`` when ``ENV_TYPE=dev`` (best-effort)."""
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
    env_type = resolve_env_type()
    if env_type not in {"dev", "prod"}:
        raise ValueError(f"ENV_TYPE must be dev or prod, got {env_type!r}")

    cfg: dict[str, str] = {}

    if env_type == "dev":
        _load_dotenv_for_dev()
        for k, v in os.environ.items():
            if v is not None and v != "" and k not in cfg:
                cfg[k] = v
        cfg["ENV_TYPE"] = "dev"
        _apply_dev_defaults(cfg)
    else:  # prod
        for k, v in os.environ.items():
            if v is not None and v != "":
                cfg[k] = v
        cfg["ENV_TYPE"] = "prod"
        load_from_aws(cfg)
        _load_prod_non_secret_overrides(cfg)

    merged_base: dict[str, Any] = {k: v for k, v in os.environ.items() if v is not None and v != ""}
    merged_base.update({k: v for k, v in cfg.items() if v is not None and v != ""})
    merged: dict[str, Any] = merged_base
    merged["ENV_TYPE"] = env_type

    settings = Settings(**merged)

    if settings.is_prod:
        _validate_prod_strict(settings)

    _log_info("config_loaded", env_type=env_type, is_prod=settings.is_prod)
    return settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached ``Settings`` (process-wide singleton).

    Mirrors ``inference`` ``get_settings`` and ``workers`` ``createConfig``.
    Clear with ``clear_settings_cache()`` in tests.
    """
    return _build_settings()


def clear_settings_cache() -> None:
    """Clear the ``get_settings`` cache — for tests only."""
    get_settings.cache_clear()
