from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    API_TITLE: str = "File Processing Service"
    API_VERSION: str = "1.0.0"
    
    MAX_UPLOAD_SIZE_BYTES: int = 10 * 1024 * 1024  # 10MB
    MAX_TEXT_LENGTH: int = 1_000_000  # Prevent memory bombs
    
    ALLOWED_MIME_TYPES: list[str] = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain"
    ]

    class Config:
        env_file = ".env"

settings = Settings()