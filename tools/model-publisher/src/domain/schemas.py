from pydantic import BaseModel, Field, field_validator
from pathlib import Path

class ModelMetadata(BaseModel):
    model_key: str
    version: str
    description: str

class ArtifactBundle(BaseModel):
    metadata: ModelMetadata
    local_path: Path

    @field_validator("local_path")
    @classmethod
    def validate_path(cls, v: Path) -> Path:
        if not v.exists() or not v.is_dir():
            raise ValueError(f"Path does not exist or is not a directory: {v}")
        return v