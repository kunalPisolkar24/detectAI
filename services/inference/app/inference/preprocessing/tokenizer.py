"""The tokenizer port and the encoding it produces."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Encoding:
    """A tokenized document: the content tokens and where each one sits in the text."""

    ids: tuple[int, ...]
    offsets: tuple[tuple[int, int], ...]


class Tokenizer(Protocol):
    """The tokenizer surface the plane needs; nothing else."""

    cls_token_id: int
    sep_token_id: int
    pad_token_id: int
    special_token_count: int

    def encode(self, text: str) -> Encoding:
        """Token IDs without special tokens, plus each token's character span."""
        ...
