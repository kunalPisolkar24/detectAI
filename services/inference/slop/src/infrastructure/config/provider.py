"""Dev / prod config provider — mirrors gateway/workers ``ChainProvider``.

Responsibilities (single entry point: ``get_settings()``):
- Resolve ``ENV_TYPE`` (canonical) with deprecated ``ENV`` / ``CONFIG_SOURCE`` mapping.
- ``dev``: load ``.env`` / ``ENV_FILE`` via ``python-dotenv``, apply dev defaults.
- ``prod``: load Secrets Manager + SSM via ``aws.load_from_aws``, apply non-secret overrides, strict validation.
- Cache result (``lru_cache``) and expose ``clear_settings_cache()`` for tests.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

import structlog

from src.infrastructure.config.aws import load_from_aws
from src.infrastructure.config.settings import Settings

logger = structlog.get_logger()

_DEV_DEFAULTS: dict[str, str] = {
    "OTEL_SERVICE_NAME": "inference",
    "AWS_REGION": "ap-south-1",
}

# Non-secret keys that may be overridden via env in prod (secrets never).
_PROD_NON_SECRET_OVERRIDES = (
    "GRPC_PORT",
    "GRPC_MAX_WORKERS",
    "METRICS_PORT",
    "LOG_LEVEL",
    "MODEL_CACHE_DIR",
    "SPARK_MODEL_REVISION",
    "FLARE_MODEL_REVISION",
    "BATCH_SIZE",
    "BATCH_TIMEOUT",
    "BATCH_QUEUE_MAX_SIZE",
    "INFERENCE_MAX_WORKERS",
    "MAX_CONCURRENT_BATCHES",
    "MAX_INFLIGHT_DOC_CHUNKS",
    "MAX_TEXT_CHARS",
    "MAX_GLOBAL_TOKENS",
    "CHUNK_TOKEN_LIMIT",
    "CHUNK_TOKEN_STRIDE",
    "INFERENCE_PROVIDERS",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_SERVICE_NAME",
    "OTEL_SERVICE_VERSION",
    "SERVICE_VERSION",
    "AWS_REGION",
    "AWS_ENDPOINT_URL",
    "SSM_PREFIX",
    "SSM_ENABLED",
    "INFERENCE_SECRETS_NAME",
)


def _env_or(key: str, fallback: str) -> str:
    v = os.getenv(key)
    return v if v is not None and v != "" else fallback


def resolve_env_type() -> str:
    """Resolve ``ENV_TYPE`` with legacy fallbacks (matches gateway/workers)."""
    raw = os.getenv("ENV_TYPE")
    if raw is not None and raw.strip() != "":
        return raw.strip().lower()

    # Deprecated aliases: ENV (inference legacy) and CONFIG_SOURCE (workers legacy)
    for legacy_key in ("ENV", "CONFIG_SOURCE"):
        legacy = os.getenv(legacy_key)
        if legacy is not None and legacy.strip() != "":
            v = legacy.strip().lower()
            logger.warning(
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

    # Workers also checks NODE_ENV; keep for parity but not primary
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
    if not settings.API_KEY:
        raise ValueError("ENV_TYPE=prod requires API_KEY from AWS (detectai/inference/secrets) or env")
    # Reject dev fallback secrets in prod (hardcoded examples / test values)
    dev_markers = ("dev-secret", "test-secret", "mock-", "change-me", "not-configured")
    lower_key = settings.API_KEY.lower()
    if any(m in lower_key for m in dev_markers):
        raise ValueError("ENV_TYPE=prod must not use default dev API_KEY")
    if not settings.AWS_REGION:
        raise ValueError("ENV_TYPE=prod requires AWS_REGION")
    # BATCH / CHUNK cross-checks are already validated by Settings, but re-check dev markers for API_KEY only
    # Additional: ensure API_KEY length already validated (>=16) via Settings


def _load_dotenv_for_dev() -> None:
    """Load ``.env`` / ``ENV_FILE`` when ``ENV_TYPE=dev`` (best-effort)."""
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        return

    # Prefer .env in CWD or service root; fallback to ENV_FILE
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

    # Snapshot env into mutable dict; provider mutates ``cfg`` in place (like workers/gateway)
    cfg: dict[str, str] = {}

    if env_type == "dev":
        _load_dotenv_for_dev()
        # Copy current env (including dotenv) into cfg, env wins — skip empty strings (compose sets empty for unset)
        for k, v in os.environ.items():
            if v is not None and v != "" and k not in cfg:
                cfg[k] = v
        cfg["ENV_TYPE"] = "dev"
        _apply_dev_defaults(cfg)
        # Also bridge AI_SERVICE_API_KEY if still present in env and API_KEY missing in cfg
        if not cfg.get("API_KEY") and os.getenv("AI_SERVICE_API_KEY"):
            bridged = os.getenv("AI_SERVICE_API_KEY", "")
            if bridged:
                logger.warning("deprecated_env_var_used", legacy_key="AI_SERVICE_API_KEY", hint="Use API_KEY")
                cfg["API_KEY"] = bridged
    else:  # prod
        for k, v in os.environ.items():
            if v is not None and v != "":
                cfg[k] = v
        cfg["ENV_TYPE"] = "prod"
        load_from_aws(cfg)
        _load_prod_non_secret_overrides(cfg)
        if not cfg.get("API_KEY") and os.getenv("AI_SERVICE_API_KEY"):
            bridged = os.getenv("AI_SERVICE_API_KEY", "")
            if bridged and not cfg.get("API_KEY"):
                logger.warning("prod_secret_from_env_fallback", key="AI_SERVICE_API_KEY")
                # Do not auto-bridge in prod; strict validation will require AWS. Keep warning only.

    # Merge with process env (cfg wins over env for AWS-supplied values). Filter empty strings so Settings defaults apply and validation doesn't fail on "".
    merged_base: dict[str, Any] = {k: v for k, v in os.environ.items() if v is not None and v != ""}
    merged_base.update({k: v for k, v in cfg.items() if v is not None and v != ""})
    merged: dict[str, Any] = merged_base
    merged["ENV_TYPE"] = env_type

    settings = Settings(**merged)

    if settings.is_prod:
        _validate_prod_strict(settings)

    logger.info("config_loaded", env_type=env_type, is_prod=settings.is_prod)
    return settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached ``Settings`` (process-wide singleton).

    Mirrors ``workers`` ``createConfig`` and ``gateway`` ``ChainProvider.Load``.
    Clear with ``clear_settings_cache()`` in tests.
    """
    return _build_settings()


def clear_settings_cache() -> None:
    """Clear the ``get_settings`` cache — for tests only."""
    get_settings.cache_clear()
