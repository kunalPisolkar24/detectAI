from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    ENV: str = "production"
    GRPC_PORT: int = 50051
    API_KEY: str
    MODEL_CACHE_DIR: str = "./models"
    
    BATCH_SIZE: int = 32
    BATCH_TIMEOUT: float = 0.05
    MAX_TEXT_LENGTH: int = 5000
    
    class Config:
        env_file = ".env"

settings = Settings()