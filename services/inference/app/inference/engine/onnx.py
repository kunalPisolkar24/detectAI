"""The ONNX Runtime adapter: the engine's only route to a forward pass."""

from collections.abc import Sequence
from typing import Any

import numpy as np

from .errors import EngineError

# The shape the artifacts' logits come back in, and the column that holds the AI class.
_LOGIT_COLUMNS = 2
_AI_COLUMN = 1

# The probe length: a valid vocabulary entry per position, so the graph runs
# end to end in milliseconds and a corrupt artifact fails the boot fast.
_PROBE_TOKENS = 8


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
        if not sequences:
            return ()
        self._guard(sequences)
        input_ids, attention_mask = self._pad(sequences)
        logits = self._logits(input_ids, attention_mask, len(sequences))
        probabilities = self._probability(logits)
        return tuple(float(value) for value in probabilities[:, _AI_COLUMN])

    def warmup(self, sequence_length: int) -> None:
        """Prove the session executes: a cheap probe, then the production shape."""
        if sequence_length < 1:
            raise EngineError(
                f"the warmup length is {sequence_length}; at least one token is needed"
            )
        if sequence_length > self._max_sequence_length:
            raise EngineError(
                f"the warmup length is {sequence_length}; the model's ceiling is "
                f"{self._max_sequence_length}"
            )
        self.score([(self._pad_token_id,) * _PROBE_TOKENS])
        self.score([(self._pad_token_id,) * sequence_length] * self._batch_size)

    def _guard(self, sequences: Sequence[Sequence[int]]) -> None:
        """Refuse a call the session may not hold: never truncate, never attempt."""
        if len(sequences) > self._batch_size:
            raise EngineError(
                f"the call is {len(sequences)} wide; the engine accepts at most "
                f"{self._batch_size}"
            )
        for index, sequence in enumerate(sequences):
            if not sequence:
                raise EngineError(f"sequence {index} is empty")
            if len(sequence) > self._max_sequence_length:
                raise EngineError(
                    f"sequence {index} is {len(sequence)} tokens; the model's ceiling "
                    f"is {self._max_sequence_length}"
                )

    def _pad(self, sequences: Sequence[Sequence[int]]) -> tuple[np.ndarray, np.ndarray]:
        """The padded input ids and the attention mask for one call."""
        width = max(len(sequence) for sequence in sequences)
        input_ids = np.full((len(sequences), width), self._pad_token_id, dtype=np.int64)
        attention_mask = np.zeros((len(sequences), width), dtype=np.int64)
        for row, sequence in enumerate(sequences):
            length = len(sequence)
            input_ids[row, :length] = sequence
            attention_mask[row, :length] = 1
        return input_ids, attention_mask

    def _logits(
        self, input_ids: np.ndarray, attention_mask: np.ndarray, batch: int
    ) -> np.ndarray:
        """Run the session once and hold its output to the artifacts' contract."""
        feed = {"input_ids": input_ids, "attention_mask": attention_mask}
        try:
            outputs = self._session.run(None, feed)
        except Exception as error:
            raise EngineError(f"the session run failed: {error}") from error
        if not outputs:
            raise EngineError("the session returned no output")
        try:
            logits = np.asarray(outputs[0], dtype=np.float32)
        except (TypeError, ValueError) as error:
            raise EngineError(f"the session returned a non-numeric output: {error}") from error
        if logits.shape != (batch, _LOGIT_COLUMNS):
            raise EngineError(
                f"the session returned logits of shape {logits.shape}; the contract is "
                f"({batch}, {_LOGIT_COLUMNS})"
            )
        if not np.isfinite(logits).all():
            raise EngineError("the session returned non-finite logits")
        return logits

    def _probability(self, logits: np.ndarray) -> np.ndarray:
        """The two-class softmax; column one is the AI class."""
        shifted = logits - logits.max(axis=1, keepdims=True)
        exponentials = np.exp(shifted)
        return exponentials / exponentials.sum(axis=1, keepdims=True)
