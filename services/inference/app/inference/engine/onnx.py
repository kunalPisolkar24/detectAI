"""The ONNX Runtime adapter: the engine's only route to a forward pass."""

from collections.abc import Sequence
from typing import Any

import numpy as np


class OnnxEngine:
    """Satisfies Engine structurally; the only module in this package that talks to ONNX Runtime."""

    def __init__(
        self,
        session: Any,
        pad_token_id: int,
        max_sequence_length: int,
        batch_size: int,
    ) -> None:
        self._session = session
        self._pad_token_id = pad_token_id
        self._max_sequence_length = max_sequence_length
        self._batch_size = batch_size

    def score(self, sequences: Sequence[Sequence[int]]) -> tuple[float, ...]:
        """One AI probability per token-id sequence, in the same order."""
        raise NotImplementedError

    def warmup(self) -> None:
        """Prove the session executes: a cheap probe, then the production shape."""
        raise NotImplementedError

    def _pad(self, sequences: Sequence[Sequence[int]]) -> tuple[np.ndarray, np.ndarray]:
        """The padded input ids and the attention mask for one call."""
        raise NotImplementedError

    def _probability(self, logits: np.ndarray) -> np.ndarray:
        """The two-class softmax; column one is the AI class."""
        raise NotImplementedError
