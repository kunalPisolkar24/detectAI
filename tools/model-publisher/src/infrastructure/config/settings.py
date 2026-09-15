"""Typed settings for model-publisher — no I/O here, provider handles loading."""

from __future__ import annotations

from typing import Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    hf_token: str = Field(min_length=1, repr=False)
    hf_username: str = Field(min_length=1)
    assets_dir_name: str = Field(default="assets")
    project_root_dir: str = Field(default=".")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        env_ignore_empty=True,
    )

    @field_validator("hf_token", mode="before")
    @classmethod
    def _validate_token(cls, v: Any) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            raise ValueError("HF_TOKEN must be non-empty")
        if isinstance(v, str):
            raw = v.strip()
            if len(raw) < 8:
                raise ValueError("HF_TOKEN looks too short")
            # reject obvious placeholders
            low = raw.lower()
            if low in {"test", "mock-token", "not-configured", "change-me"} or "placeholder" in low:
                raise ValueError("HF_TOKEN must not be a placeholder")
            return raw
        return v

    @field_validator("hf_username", mode="before")
    @classmethod
    def _validate_username(cls, v: Any) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            raise ValueError("HF_USERNAME must be non-empty")
        if isinstance(v, str):
            return v.strip()
        return v

    @field_validator("assets_dir_name", "project_root_dir", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip() or v
        return v
