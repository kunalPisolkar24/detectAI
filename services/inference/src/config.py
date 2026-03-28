import os

from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    ENV: str = "production"
    GRPC_PORT: int = 50051
    METRICS_PORT: int = 8333
    API_KEY: str
    MODEL_CACHE_DIR: str = "./models"
    
    BATCH_SIZE: int = 32
    BATCH_TIMEOUT: float = 0.05
    MAX_TEXT_LENGTH: int = 5000
    INFERENCE_PROVIDERS: str = "CUDAExecutionProvider,CPUExecutionProvider"
    
    model_config = SettingsConfigDict(env_file=os.getenv("ENV_FILE") or None)

try:
    settings = Settings()
except Exception:
    settings = Settings(API_KEY="placeholder")
