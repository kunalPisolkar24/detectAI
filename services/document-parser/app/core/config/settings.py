"""Canonical Settings for the document-parser service.

Responsibilities:
- Single source of truth for all runtime tunables.
- Strong validation (ranges, allow-lists, cross-field checks).
- No I/O: env-file / AWS loading is handled by ``provider``.
"""

from __future__ import annotations

import json
import os
import re
from typing import Annotated, Any, Literal

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_ALLOWED_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "WARN", "ERROR", "CRITICAL"})
_GIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")

# Allow CSV or JSON array for list fields — same pattern as inference.
MimeList = Annotated[list[str], NoDecode]


def parse_mime_types(value: Any) -> list[str]:
    """Parse ``ALLOWED_MIME_TYPES`` from string (CSV / JSON) or list."""
    if value is None:
        return [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain",
        ]
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            raise ValueError("ALLOWED_MIME_TYPES must contain at least one MIME type")
        if normalized.startswith("["):
            try:
                value = json.loads(normalized)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    "ALLOWED_MIME_TYPES must be a valid JSON array or a comma-separated string"
                ) from exc
        else:
            value = normalized.split(",")

    if isinstance(value, tuple):
        value = list(value)

    if not isinstance(value, list):
        raise TypeError("ALLOWED_MIME_TYPES must be a list of strings")

    mimes: list[str] = []
    for m in value:
        if not isinstance(m, str):
            raise TypeError("ALLOWED_MIME_TYPES must contain only strings")
        norm = m.strip()
        if norm:
            mimes.append(norm)

    if not mimes:
        raise ValueError("ALLOWED_MIME_TYPES must contain at least one MIME type")

    for m in mimes:
        if "/" not in m:
            raise ValueError(f"Invalid MIME type {m!r} — expected 'type/subtype'")

    return mimes


class Settings(BaseSettings):
    """Typed, validated runtime configuration."""

    # -- env type ---------------------------------------------------------
    ENV_TYPE: Literal["dev", "prod"] = Field(default="dev")

    # -- api meta (kept for factory, not env-driven heavily) ------------
    API_TITLE: str = Field(default="Document Parser Service")
    API_VERSION: str = Field(default="1.0.0")

    # -- network ----------------------------------------------------------
    PORT: int = Field(default=8000, gt=0, le=65535)
    WORKER_THREADS: int = Field(
        default_factory=lambda: os.cpu_count() or 4,
        gt=0,
        le=128,
        description="ThreadPoolExecutor workers for extraction",
    )

    # -- limits -----------------------------------------------------------
    MAX_UPLOAD_SIZE_BYTES: int = Field(default=10 * 1024 * 1024, gt=0)
    MAX_TEXT_LENGTH: int = Field(default=1_000_000, gt=0)
    MAX_PDF_PAGES: int = Field(default=1000, gt=0)
    MAX_DOCX_UNCOMPRESSED_BYTES: int = Field(default=100 * 1024 * 1024, gt=0)
    EXTRACTION_TIMEOUT_SECONDS: float = Field(default=30.0, gt=0, le=600)
    READINESS_MAX_QUEUE_DEPTH: int = Field(default=50, gt=0)

    # -- parsing tunables -------------------------------------------------
    HEADER_FOOTER_MARGIN_PT: float = Field(default=40.0, ge=0, le=500)
    HEADER_REPETITION_RATIO: float = Field(default=0.8, ge=0, le=1)
    ALLOWED_MIME_TYPES: MimeList = Field(
        default_factory=lambda: [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain",
        ]
    )

    # -- observability ----------------------------------------------------
    LOG_LEVEL: str = Field(default="INFO")
    OTEL_EXPORTER_OTLP_ENDPOINT: str | None = Field(default=None)
    OTEL_SERVICE_NAME: str = Field(default="document-parser")
    OTEL_SERVICE_VERSION: str = Field(
        default="1.0.0",
        validation_alias=AliasChoices("OTEL_SERVICE_VERSION", "SERVICE_VERSION"),
    )

    # -- AWS bootstrap (not used at runtime except for config loading) ---
    AWS_REGION: str = Field(default="ap-south-1")
    AWS_ENDPOINT_URL: str | None = Field(default=None)
    SSM_PREFIX: str | None = Field(default=None)
    SSM_ENABLED: str | None = Field(default=None)
    DOCUMENT_PARSER_SECRETS_NAME: str | None = Field(default=None)

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

    @field_validator("OTEL_EXPORTER_OTLP_ENDPOINT", mode="before")
    @classmethod
    def _empty_otlp_to_none(cls, value: Any) -> Any:
        if value == "" or value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("AWS_ENDPOINT_URL", "SSM_PREFIX", "SSM_ENABLED", "DOCUMENT_PARSER_SECRETS_NAME", mode="before")
    @classmethod
    def _empty_aws_to_none(cls, value: Any) -> Any:
        if value == "" or value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("ALLOWED_MIME_TYPES", mode="before")
    @classmethod
    def _parse_mimes(cls, value: Any) -> list[str]:
        # pydantic_settings with NoDecode already gives raw; handle None via default_factory elsewhere
        if value is None:
            return parse_mime_types([
                "application/pdf",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "text/plain",
            ])
        return parse_mime_types(value)

    @field_validator("OTEL_EXPORTER_OTLP_ENDPOINT", mode="after")
    @classmethod
    def _validate_otlp(cls, value: str | None) -> str | None:
        if value is None:
            return None
        # Minimal URL check — allow http(s)://
        if not (value.startswith("http://") or value.startswith("https://")):
            raise ValueError(f"OTEL_EXPORTER_OTLP_ENDPOINT must be http(s) URL, got {value!r}")
        return value

    @model_validator(mode="after")
    def _validate_cross_fields(self) -> "Settings":
        # header repetition ratio already bounded 0..1 via Field
        return self
