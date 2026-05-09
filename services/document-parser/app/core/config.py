import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    API_TITLE: str = "File Processing Service"
    API_VERSION: str = "1.0.0"
    
    MAX_UPLOAD_SIZE_BYTES: int = 10 * 1024 * 1024
    MAX_TEXT_LENGTH: int = 1_000_000
    WORKER_THREADS: int = int(os.getenv("WORKER_THREADS", os.cpu_count() or 4))
    
    ALLOWED_MIME_TYPES: list[str] = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain"
    ]

    model_config = SettingsConfigDict(
        env_file=os.getenv("ENV_FILE") or None, 
        env_file_encoding="utf-8"
    )

settings = Settings()
