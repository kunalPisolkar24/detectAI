"""The ONNX Runtime loader skeleton: contracts now, session and tokenizer bodies with the implementation."""

import logging
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from .loader import LoadedModel

logger = logging.getLogger(__name__)

_ONNX_MODEL_FILENAME = "model.onnx"


class OnnxModelLoader:
    """Satisfies ModelLoader structurally; the only module that imports onnxruntime and transformers."""

    def __init__(self, providers: Sequence[str], intra_op_threads: int = 0) -> None:
        self._providers = tuple(providers)
        self._intra_op_threads = intra_op_threads

    def load_all(self, artifacts: Mapping[str, Path]) -> Mapping[str, LoadedModel]:
        """Walk the keys sorted and fail fast; the first failure aborts with ModelLoadError."""
        raise NotImplementedError

    def _load(self, key: str, path: Path) -> LoadedModel:
        """Build the session, the tokenizer, log the effective providers, and pair them."""
        raise NotImplementedError

    def _session(self, path: Path) -> Any:
        """Build one InferenceSession from model.onnx with fresh session options."""
        raise NotImplementedError

    def _tokenizer(self, path: Path) -> Any:
        """Load the HF tokenizer from the artifact dir, strictly offline."""
        raise NotImplementedError

    def _log_effective_providers(self, key: str, session: Any) -> None:
        """Log requested vs effective providers; a mismatch is a loud warning."""
        raise NotImplementedError
