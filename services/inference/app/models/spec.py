"""The per-model pull contract: pure data, built once from the Settings contract."""

from pydantic import BaseModel, ConfigDict

from ..config.settings import Settings


class ModelSpec(BaseModel):
    """One model's pull contract: identity, the pinned build, and where it sits in the repo."""

    model_config = ConfigDict(frozen=True)

    key: str
    repo: str
    revision: str
    artifact_dir: str


class ModelSpecs:
    @classmethod
    def from_settings(cls, settings: Settings) -> tuple[ModelSpec, ...]:
        raise NotImplementedError("ModelSpecs.from_settings")
