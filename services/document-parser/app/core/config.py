import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    API_TITLE: str = "Document Parser Service"
    API_VERSION: str = "1.0.0"

    MAX_UPLOAD_SIZE_BYTES: int = Field(default=10 * 1024 * 1024)
    MAX_TEXT_LENGTH: int = Field(default=1_000_000)
    MAX_PDF_PAGES: int = Field(default=1000)
    MAX_DOCX_UNCOMPRESSED_BYTES: int = Field(default=100 * 1024 * 1024)
    EXTRACTION_TIMEOUT_SECONDS: float = Field(default=30.0)
    READINESS_MAX_QUEUE_DEPTH: int = Field(default=50)
    WORKER_THREADS: int = Field(default_factory=lambda: os.cpu_count() or 4)

    HEADER_FOOTER_MARGIN_PT: float = Field(default=40.0)
    HEADER_REPETITION_RATIO: float = Field(default=0.8)

    ALLOWED_MIME_TYPES: list[str] = Field(
        default=[
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain",
        ]
    )

    model_config = SettingsConfigDict(
        env_file=os.getenv("ENV_FILE") or None,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
