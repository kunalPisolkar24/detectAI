from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    hf_token: str
    hf_username: str
    assets_dir_name: str = "assets"
    project_root_dir: str = "."

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()