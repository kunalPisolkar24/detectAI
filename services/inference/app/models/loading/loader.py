"""The load port: the loading slice's entire view of the pulled artifacts."""

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


@dataclass(frozen=True)
class LoadedModel:
    """One model's load result: the pulled identity plus the runtime pair the serving slice consumes."""

    key: str
    session: Any
    tokenizer: Any
    max_sequence_length: int


class ModelLoader(Protocol):
    def load_all(self, artifacts: Mapping[str, Path]) -> Mapping[str, LoadedModel]:
        """Build every pulled model; the first failure aborts with ModelLoadError."""
        ...
