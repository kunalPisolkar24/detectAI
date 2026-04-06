import os
from typing import Annotated, Any

from pydantic import Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from src.core.inference_providers import parse_inference_providers

InferenceProviders = Annotated[list[str], NoDecode]

class Settings(BaseSettings):
    ENV: str = "production"
    GRPC_PORT: int = 50051
    GRPC_MAX_WORKERS: int = 50
    METRICS_PORT: int = 8333
    API_KEY: str
    MODEL_CACHE_DIR: str = "./models"
    
    BATCH_SIZE: int = 32
    BATCH_TIMEOUT: float = 0.05
    BATCH_QUEUE_MAX_SIZE: int = 1024
    MAX_INFLIGHT_DOC_CHUNKS: int = 8
    MAX_TEXT_CHARS: int = Field(default=50000, validation_alias="MAX_TEXT_LENGTH")
    MAX_GLOBAL_TOKENS: int = 10000
    CHUNK_TOKEN_LIMIT: int = 256
    CHUNK_TOKEN_STRIDE: int = 192
    INFERENCE_PROVIDERS: InferenceProviders = Field(
        default_factory=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    
    model_config = SettingsConfigDict(env_file=os.getenv("ENV_FILE") or None)

    @field_validator("INFERENCE_PROVIDERS", mode="before")
    @classmethod
    def _parse_inference_providers(cls, value: Any) -> list[str]:
        return parse_inference_providers(value)


def _build_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        errors = exc.errors(include_url=False)
        if len(errors) == 1 and errors[0].get("loc") == ("API_KEY",) and errors[0].get("type") == "missing":
            return Settings(API_KEY="placeholder")
        raise


settings = _build_settings()
