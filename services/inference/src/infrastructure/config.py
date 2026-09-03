import json
import os
import re
from functools import lru_cache
from typing import Annotated, Any

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


def parse_inference_providers(value: Any) -> list[str]:
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
    ENV: str = "production"
    GRPC_PORT: int = Field(default=50051, gt=0, le=65535)
    GRPC_MAX_WORKERS: int = Field(default=50, gt=0, le=500)
    METRICS_PORT: int = Field(default=8333, gt=0, le=65535)
    API_KEY: str = Field(min_length=16)
    MODEL_CACHE_DIR: str = "./models"
    SPARK_MODEL_REVISION: str = "9a48004391c71272d6fb1d164ed7c56e1fbfe360"
    FLARE_MODEL_REVISION: str = "e1911c0be59f4e10f0d120f639d1358e46bc2086"

    BATCH_SIZE: int = Field(default=32, gt=0, le=512)
    BATCH_TIMEOUT: float = Field(default=0.05, gt=0, le=10)
    BATCH_QUEUE_MAX_SIZE: int = Field(default=1024, gt=0, le=10000)
    INFERENCE_MAX_WORKERS: int = Field(default=32, gt=0, le=128)
    MAX_CONCURRENT_BATCHES: int = Field(default=4, gt=0, le=32)
    MAX_INFLIGHT_DOC_CHUNKS: int = Field(default=8, gt=0, le=64)
    MAX_TEXT_CHARS: int = Field(
        default=50000,
        validation_alias=AliasChoices("MAX_TEXT_CHARS", "MAX_TEXT_LENGTH"),
        gt=0,
        le=200000,
    )
    MAX_GLOBAL_TOKENS: int = Field(default=10000, gt=0, le=100000)
    CHUNK_TOKEN_LIMIT: int = Field(default=256, gt=0, le=2048)
    CHUNK_TOKEN_STRIDE: int = Field(default=192, gt=0, le=2048)
    INFERENCE_PROVIDERS: InferenceProviders = Field(
        default_factory=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"]
    )

    model_config = SettingsConfigDict(
        env_file=os.getenv("ENV_FILE") or None, populate_by_name=True, extra="ignore"
    )

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
    def _validate_api_key(cls, value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("API_KEY must be a non-empty string")
        return value

    @model_validator(mode="after")
    def _validate_chunk_settings(self) -> "Settings":
        if self.CHUNK_TOKEN_STRIDE > self.CHUNK_TOKEN_LIMIT:
            raise ValueError("CHUNK_TOKEN_STRIDE must be less than or equal to CHUNK_TOKEN_LIMIT")
        if self.MAX_GLOBAL_TOKENS < self.CHUNK_TOKEN_LIMIT:
            raise ValueError("MAX_GLOBAL_TOKENS must be >= CHUNK_TOKEN_LIMIT")
        if self.BATCH_QUEUE_MAX_SIZE < self.BATCH_SIZE:
            raise ValueError("BATCH_QUEUE_MAX_SIZE must be >= BATCH_SIZE")
        if self.INFERENCE_MAX_WORKERS < self.MAX_CONCURRENT_BATCHES:
            raise ValueError("INFERENCE_MAX_WORKERS must be >= MAX_CONCURRENT_BATCHES")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


# Backwards-compatible eager instance; uses cached factory. Falls back to lazy proxy if env missing
try:
    settings = get_settings()
except Exception:  # pragma: no cover — allows import in tests without env
    # Provide a dummy that defers validation until accessed; tests construct Settings explicitly
    class _LazySettings:
        def __getattr__(self, name: str) -> Any:
            return getattr(get_settings(), name)

    settings = _LazySettings()  # type: ignore[assignment]
