"""The ONNX Runtime loader: offline session and tokenizer builds from pulled artifacts."""

import json
import logging
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import onnxruntime as ort
from transformers import AutoTokenizer

from ..errors import ModelLoadError
from .loader import LoadedModel

logger = logging.getLogger(__name__)

_ONNX_MODEL_FILENAME = "model.onnx"
_TOKENIZER_CONFIG_FILENAME = "tokenizer_config.json"


class OnnxModelLoader:
    """Satisfies ModelLoader structurally; the only module that imports onnxruntime and transformers."""

    def __init__(
        self,
        providers: Sequence[str],
        ceilings: Mapping[str, int],
        intra_op_threads: int = 0,
    ) -> None:
        self._providers = list(providers)
        self._ceilings = dict(ceilings)
        self._intra_op_threads = intra_op_threads

    def load_all(self, artifacts: Mapping[str, Path]) -> Mapping[str, LoadedModel]:
        """Every key resolved to a runtime pair, walked sorted; the first failure aborts."""
        started = time.perf_counter()
        logger.info("model loading: ensuring %s", ", ".join(sorted(artifacts)))

        loaded: dict[str, LoadedModel] = {}
        for key in sorted(artifacts):
            loaded[key] = self._load(key, artifacts[key])

        logger.info("model loading: ready in %.1fs", time.perf_counter() - started)
        return loaded

    def _load(self, key: str, path: Path) -> LoadedModel:
        """Build the session and the tokenizer, read the ceiling, verify the providers, and pair them."""
        started = time.perf_counter()
        try:
            session = self._session(path)
            tokenizer = self._tokenizer(path)
        except Exception as error:
            raise ModelLoadError(f"{key}: load failed from {path}: {error}") from error
        max_sequence_length = self._max_sequence_length(key, path)
        self._log_effective_providers(key, session)
        logger.info("%s: loaded in %.1fs", key, time.perf_counter() - started)
        return LoadedModel(
            key=key,
            session=session,
            tokenizer=tokenizer,
            max_sequence_length=max_sequence_length,
        )

    def _max_sequence_length(self, key: str, path: Path) -> int:
        """The configured ceiling, checked against the length the artifact declares."""
        ceiling = self._ceilings.get(key)
        if ceiling is None:
            raise ModelLoadError(f"{key}: no sequence ceiling is configured")
        declared = self._declared_length(key, path)
        if declared is not None and ceiling > declared:
            raise ModelLoadError(
                f"{key}: the configured ceiling is {ceiling} tokens; the artifact "
                f"was built for {declared}"
            )
        return ceiling

    def _declared_length(self, key: str, path: Path) -> int | None:
        """The length the artifact says it was trained at, when it says one at all.

        The position-embedding ceiling is not this: it says how long the model
        could go, not how long it was built to score.
        """
        config_path = path / _TOKENIZER_CONFIG_FILENAME
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise ModelLoadError(
                f"{key}: unreadable {_TOKENIZER_CONFIG_FILENAME} in {path}: {error}"
            ) from error
        if not isinstance(config, dict):
            raise ModelLoadError(f"{key}: {_TOKENIZER_CONFIG_FILENAME} in {path} is not an object")
        declared = config.get("max_length")
        if isinstance(declared, bool) or not isinstance(declared, int) or declared <= 0:
            return None
        return declared

    def _session(self, path: Path) -> Any:
        """One InferenceSession from model.onnx; session options are never shared."""
        options = ort.SessionOptions()
        if self._intra_op_threads > 0:
            options.intra_op_num_threads = self._intra_op_threads
        return ort.InferenceSession(
            str(path / _ONNX_MODEL_FILENAME),
            sess_options=options,
            providers=self._providers,
        )

    def _tokenizer(self, path: Path) -> Any:
        """The HF tokenizer from the artifact dir; strictly offline, never the hub."""
        return AutoTokenizer.from_pretrained(str(path), local_files_only=True)

    def _log_effective_providers(self, key: str, session: Any) -> None:
        """Compare by missing, never equality: ORT appends CPU as a fallback tail."""
        effective = list(session.get_providers())
        missing = [name for name in self._providers if name not in effective]
        if missing:
            logger.warning(
                "%s: provider mismatch: requested %s, effective %s",
                key, self._providers, effective,
            )
        else:
            logger.info("%s: providers %s", key, effective)
