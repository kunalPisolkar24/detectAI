"""The engine port: token-id sequences in, one AI probability each."""

from collections.abc import Sequence
from typing import Protocol


class Engine(Protocol):
    """The engine surface the caller needs; nothing else."""

    def score(self, sequences: Sequence[Sequence[int]]) -> tuple[float, ...]:
        """One AI probability per token-id sequence, in the same order."""
        ...
