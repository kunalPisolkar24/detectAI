"""Canonical Settings for the inference service.

Responsibilities:
- Single source of truth for all runtime tunables.
- Strong validation (ranges, allow-lists, cross-field checks).
- No I/O: env-file / AWS loading is handled by ``provider``.
"""

from __future__ import annotations

import json
import re
from typing import Annotated, Any, Literal

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

InferenceProviders = Annotated[list[str], NoDecode]
_GIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
_KNOWN_PROVIDERS = frozenset(
    {
        "CPUExecutionProvider",
        "CUDAExecutionProvider",
        "TensorrtExecutionProvider",
        "ROCMExecutionProvider",
        "OpenVINOExecutionProvider",
    }
)
_ALLOWED_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "WARN", "ERROR", "CRITICAL"})


def parse_inference_providers(value: Any) -> list[str]:
    """Parse ``INFERENCE_PROVIDERS`` from string (CSV / JSON array) or list."""
    if isinstance(value, str):
        normalized_value = value.strip()
        if not normalized_value:
            raise ValueError("INFERENCE_PROVIDERS must contain at least one provider")
        if normalized_value.startswith("["):
            try:
                value = json.loads(normalized_value)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    "INFERENCE_PROVIDERS must be a valid JSON array or a comma-separated string"
                ) from exc
        else:
            value = normalized_value.split(",")

    if isinstance(value, tuple):
        value = list(value)

    if not isinstance(value, list):
        raise TypeError("INFERENCE_PROVIDERS must be a list of strings")

    providers: list[str] = []
    for provider in value:
        if not isinstance(provider, str):
            raise TypeError("INFERENCE_PROVIDERS must contain only strings")
        normalized_provider = provider.strip()
        if normalized_provider:
            providers.append(normalized_provider)

    if not providers:
        raise ValueError("INFERENCE_PROVIDERS must contain at least one provider")

    return providers


class Settings(BaseSettings):
    """Typed, validated runtime configuration."""

    # -- env type ---------------------------------------------------------
    ENV_TYPE: Literal["dev", "prod"] = Field(default="dev")

    # -- network ----------------------------------------------------------
    GRPC_PORT: int = Field(default=50051, gt=0, le=65535)
    GRPC_MAX_WORKERS: int = Field(default=50, gt=0, le=500)
    METRICS_PORT: int = Field(default=8333, gt=0, le=65535)

    # -- secrets ----------------------------------------------------------
    API_KEY: str = Field(min_length=16)
    HF_TOKEN: str | None = Field(default=None, repr=False)

    # -- model cache / revisions -----------------------------------------
    MODEL_CACHE_DIR: str = Field(default="./models")
    SPARK_MODEL_REVISION: str = Field(default="9a48004391c71272d6fb1d164ed7c56e1fbfe360")
    FLARE_MODEL_REVISION: str = Field(default="e1911c0be59f4e10f0d120f639d1358e46bc2086")

    # -- batching / concurrency ------------------------------------------
    BATCH_SIZE: int = Field(default=32, gt=0, le=512)
    BATCH_TIMEOUT: float = Field(default=0.05, gt=0, le=10)
    BATCH_QUEUE_MAX_SIZE: int = Field(default=1024, gt=0, le=10000)
    INFERENCE_MAX_WORKERS: int = Field(default=32, gt=0, le=128)
    MAX_CONCURRENT_BATCHES: int = Field(default=4, gt=0, le=32)
    MAX_INFLIGHT_DOC_CHUNKS: int = Field(default=8, gt=0, le=64)
    MAX_TEXT_CHARS: int = Field(default=50000, gt=0, le=200000)
    MAX_GLOBAL_TOKENS: int = Field(default=10000, gt=0, le=100000)
    CHUNK_TOKEN_LIMIT: int = Field(default=256, gt=0, le=2048)
    CHUNK_TOKEN_STRIDE: int = Field(default=192, gt=0, le=2048)
    INFERENCE_PROVIDERS: InferenceProviders = Field(
        default_factory=lambda: ["CPUExecutionProvider"]
    )

    # -- observability ----------------------------------------------------
    LOG_LEVEL: str = Field(default="INFO")
    OTEL_EXPORTER_OTLP_ENDPOINT: str | None = Field(default=None)
    OTEL_SERVICE_NAME: str = Field(default="inference")
    OTEL_SERVICE_VERSION: str = Field(
        default="0.1.0",
        validation_alias=AliasChoices("OTEL_SERVICE_VERSION", "SERVICE_VERSION"),
    )

    # -- AWS bootstrap (not used at runtime except for config loading) ---
    AWS_REGION: str = Field(default="ap-south-1")
    AWS_ENDPOINT_URL: str | None = Field(default=None)
    SSM_PREFIX: str | None = Field(default=None)
    SSM_ENABLED: str | None = Field(default=None)
    INFERENCE_SECRETS_NAME: str | None = Field(default=None)

    model_config = SettingsConfigDict(
        env_file=None,
        populate_by_name=True,
        extra="ignore",
        case_sensitive=False,
        env_ignore_empty=True,
    )

    # -- helpers ----------------------------------------------------------
    @property
    def is_prod(self) -> bool:
        return self.ENV_TYPE == "prod"

    @property
    def is_dev(self) -> bool:
        return self.ENV_TYPE == "dev"

    # -- validators -------------------------------------------------------
    @field_validator("ENV_TYPE", mode="before")
    @classmethod
    def _normalize_env_type(cls, value: Any) -> str:
        if value is None:
            return "dev"
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"prod", "production"}:
                return "prod"
            if normalized in {"dev", "development", "test"}:
                return "dev"
            return normalized
        return value

    @field_validator("LOG_LEVEL", mode="before")
    @classmethod
    def _normalize_log_level(cls, value: Any) -> str:
        if value is None or value == "":
            return "INFO"
        if isinstance(value, str):
            normalized = value.strip().upper()
            if normalized == "WARN":
                return "WARNING"
            if normalized in _ALLOWED_LOG_LEVELS:
                return normalized
            raise ValueError(f"LOG_LEVEL must be one of {sorted(_ALLOWED_LOG_LEVELS)}, got {value!r}")
        return value

    @field_validator("OTEL_EXPORTER_OTLP_ENDPOINT", "HF_TOKEN", mode="before")
    @classmethod
    def _empty_str_to_none(cls, value: Any) -> Any:
        if value == "" or value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("AWS_ENDPOINT_URL", "SSM_PREFIX", "SSM_ENABLED", "INFERENCE_SECRETS_NAME", mode="before")
    @classmethod
    def _empty_aws_to_none(cls, value: Any) -> Any:
        if value == "" or value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("INFERENCE_PROVIDERS", mode="before")
    @classmethod
    def _parse_inference_providers(cls, value: Any) -> list[str]:
        providers = parse_inference_providers(value)
        unknown = [p for p in providers if p not in _KNOWN_PROVIDERS]
        if unknown:
            raise ValueError(f"Unknown INFERENCE_PROVIDERS: {unknown}. Allowed: {sorted(_KNOWN_PROVIDERS)}")
        return providers

    @field_validator("SPARK_MODEL_REVISION", "FLARE_MODEL_REVISION")
    @classmethod
    def _validate_model_revision(cls, value: str) -> str:
        if not _GIT_SHA_PATTERN.fullmatch(value):
            raise ValueError("Model revisions must be full 40-character lowercase git SHAs")
        return value

    @field_validator("API_KEY", mode="before")
    @classmethod
    def _validate_api_key(cls, value: Any) -> Any:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("API_KEY must be a non-empty string")
        if len(value.strip()) < 16:
            raise ValueError("API_KEY must be at least 16 characters")
        return value.strip()

    @field_validator("HF_TOKEN", mode="before")
    @classmethod
    def _validate_hf_token(cls, value: Any) -> Any:
        if value is None or value == "":
            return None
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return None
            return stripped
        return value

    @model_validator(mode="after")
    def _validate_cross_fields(self) -> "Settings":
        if self.CHUNK_TOKEN_STRIDE > self.CHUNK_TOKEN_LIMIT:
            raise ValueError("CHUNK_TOKEN_STRIDE must be less than or equal to CHUNK_TOKEN_LIMIT")
        if self.MAX_GLOBAL_TOKENS < self.CHUNK_TOKEN_LIMIT:
            raise ValueError("MAX_GLOBAL_TOKENS must be >= CHUNK_TOKEN_LIMIT")
        if self.BATCH_QUEUE_MAX_SIZE < self.BATCH_SIZE:
            raise ValueError("BATCH_QUEUE_MAX_SIZE must be >= BATCH_SIZE")
        if self.INFERENCE_MAX_WORKERS < self.MAX_CONCURRENT_BATCHES:
            raise ValueError("INFERENCE_MAX_WORKERS must be >= MAX_CONCURRENT_BATCHES")
        return self
