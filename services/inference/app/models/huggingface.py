"""The hub-backed artifact store; the huggingface_hub import arrives with the pull implementation."""

from pathlib import Path

from .spec import ModelSpec


class HuggingFaceStore:
    """Satisfies ArtifactStore structurally; hub errors surface only as the typed vocabulary."""

    def __init__(self, root: Path, token: str | None) -> None:
        self._root = root
        self._token = token

    def locate(self, spec: ModelSpec) -> Path:
        raise NotImplementedError("HuggingFaceStore.locate")

    def pull(self, spec: ModelSpec) -> Path:
        raise NotImplementedError("HuggingFaceStore.pull")

    def _snapshot(self, spec: ModelSpec, local_files_only: bool) -> Path:
        raise NotImplementedError("HuggingFaceStore._snapshot")

    def _is_transient(self, exc: Exception) -> bool:
        raise NotImplementedError("HuggingFaceStore._is_transient")
