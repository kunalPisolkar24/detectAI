"""Pure domain schemas — no I/O, no filesystem checks."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, field_validator

from src.domain.constants import MODEL_KEY_PATTERN, VERSION_PATTERN


class ModelMetadata(BaseModel):
    model_key: str
    version: str
    description: str

    @field_validator("model_key")
    @classmethod
    def _validate_model_key(cls, v: str) -> str:
        raw = v.strip()
        if not raw:
            raise ValueError("model_key must be non-empty")
        # allow any slug-like key; warn via constants but don't hard-reject unknown
        if not MODEL_KEY_PATTERN.fullmatch(raw):
            raise ValueError(f"model_key must match {MODEL_KEY_PATTERN.pattern!r}, got {raw!r}")
        return raw

    @field_validator("version")
    @classmethod
    def _validate_version(cls, v: str) -> str:
        raw = v.strip()
        if not raw:
            raise ValueError("version must be non-empty")
        if not VERSION_PATTERN.fullmatch(raw):
            raise ValueError(f"version must match {VERSION_PATTERN.pattern!r} (e.g. v1.0.0), got {raw!r}")
        return raw

    @field_validator("description")
    @classmethod
    def _validate_description(cls, v: str) -> str:
        raw = v.strip()
        if not raw:
            raise ValueError("description must be non-empty")
        return raw


class ArtifactBundle(BaseModel):
    """Resolved bundle — local_path is just a Path, validation is pure.

    Filesystem existence is checked in infrastructure/filesystem/resolver.py,
    not here, so domain stays testable without real FS.
    """

    metadata: ModelMetadata
    local_path: Path

    model_config = {"arbitrary_types_allowed": True}

    @field_validator("local_path", mode="before")
    @classmethod
    def _coerce_path(cls, v: object) -> Path:
        if isinstance(v, Path):
            if str(v).strip() == "":
                raise ValueError("local_path must be non-empty")
            return v
        if isinstance(v, str):
            if v.strip() == "":
                raise ValueError("local_path must be non-empty")
            return Path(v)
        raise ValueError("local_path must be a Path or string")

    @field_validator("local_path")
    @classmethod
    def _validate_path_pure(cls, v: Path) -> Path:
        # pure checks only — no exists/is_dir
        if str(v).strip() == "":
            raise ValueError("local_path must be non-empty")
        # Path("") becomes "." — treat "." with no parent as suspect only if originally empty (handled above)
        # reject null bytes etc.
        if "\x00" in str(v):
            raise ValueError("local_path contains null byte")
        return v
