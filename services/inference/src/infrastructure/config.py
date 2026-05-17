import json
import os
import re
from typing import Annotated, Any

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

InferenceProviders = Annotated[list[str], NoDecode]
_GIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")


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
    GRPC_PORT: int = Field(default=50051, gt=0)
    GRPC_MAX_WORKERS: int = Field(default=50, gt=0)
    METRICS_PORT: int = Field(default=8333, gt=0)
    API_KEY: str
    MODEL_CACHE_DIR: str = "./models"
    SPARK_MODEL_REVISION: str = "9a48004391c71272d6fb1d164ed7c56e1fbfe360"
    FLARE_MODEL_REVISION: str = "e1911c0be59f4e10f0d120f639d1358e46bc2086"

    BATCH_SIZE: int = Field(default=32, gt=0)
    BATCH_TIMEOUT: float = Field(default=0.05, gt=0)
    BATCH_QUEUE_MAX_SIZE: int = Field(default=1024, gt=0)
    INFERENCE_MAX_WORKERS: int = Field(default=32, gt=0)
    MAX_CONCURRENT_BATCHES: int = Field(default=4, gt=0)
    MAX_INFLIGHT_DOC_CHUNKS: int = Field(default=8, gt=0)
    MAX_TEXT_CHARS: int = Field(default=50000, validation_alias="MAX_TEXT_LENGTH", gt=0)
    MAX_GLOBAL_TOKENS: int = Field(default=10000, gt=0)
    CHUNK_TOKEN_LIMIT: int = Field(default=256, gt=0)
    CHUNK_TOKEN_STRIDE: int = Field(default=192, gt=0)
    INFERENCE_PROVIDERS: InferenceProviders = Field(
        default_factory=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"]
    )

    model_config = SettingsConfigDict(env_file=os.getenv("ENV_FILE") or None)

    @field_validator("INFERENCE_PROVIDERS", mode="before")
    @classmethod
    def _parse_inference_providers(cls, value: Any) -> list[str]:
        return parse_inference_providers(value)

    @field_validator("SPARK_MODEL_REVISION", "FLARE_MODEL_REVISION")
    @classmethod
    def _validate_model_revision(cls, value: str) -> str:
        if not _GIT_SHA_PATTERN.fullmatch(value):
            raise ValueError("Model revisions must be full 40-character lowercase git SHAs")
        return value

    @model_validator(mode="after")
    def _validate_chunk_settings(self) -> "Settings":
        if self.CHUNK_TOKEN_STRIDE > self.CHUNK_TOKEN_LIMIT:
            raise ValueError("CHUNK_TOKEN_STRIDE must be less than or equal to CHUNK_TOKEN_LIMIT")
        return self


settings = Settings()
