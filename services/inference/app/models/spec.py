"""The per-model pull contract: pure data, built once from the Settings contract."""

from pydantic import BaseModel, ConfigDict, model_validator

from ..config.settings import Settings

# The file names inference needs per model; the dir comes from Settings so a
# different build directory keeps working without touching these lists.
_FLARE_FILE_NAMES = (
    "model.onnx",
    "model.onnx.data",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
)
_SPARK_FILE_NAMES = (
    "config.json",
    "model.onnx",
    "model.onnx.data",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
)


def _spec_files(artifact_dir: str, names: tuple[str, ...]) -> tuple[str, ...]:
    directory = artifact_dir.rstrip("/")
    return tuple(f"{directory}/{name}" for name in names)


class ModelSpec(BaseModel):
    """One model's pull contract: identity, the pinned build, and the exact files inference needs."""

    model_config = ConfigDict(frozen=True)

    key: str
    repo: str
    revision: str
    artifact_dir: str
    files: tuple[str, ...]

    @model_validator(mode="after")
    def _files_live_under_the_artifact_dir(self) -> "ModelSpec":
        if not self.files:
            raise ValueError("at least one file is required")
        prefix = f"{self.artifact_dir.rstrip('/')}/"
        if any(not filename.startswith(prefix) for filename in self.files):
            raise ValueError("every file must live under the artifact dir")
        return self


class ModelSpecs:
    @classmethod
    def from_settings(cls, settings: Settings) -> tuple[ModelSpec, ...]:
        return (
            ModelSpec(
                key="flare",
                repo=settings.flare_model_repo,
                revision=settings.flare_model_revision,
                artifact_dir=settings.flare_model_dir,
                files=_spec_files(settings.flare_model_dir, _FLARE_FILE_NAMES),
            ),
            ModelSpec(
                key="spark",
                repo=settings.spark_model_repo,
                revision=settings.spark_model_revision,
                artifact_dir=settings.spark_model_dir,
                files=_spec_files(settings.spark_model_dir, _SPARK_FILE_NAMES),
            ),
        )
