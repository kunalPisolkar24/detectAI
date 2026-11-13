"""The tokenizer port, the HF adapter, and the encoding it produces."""

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class Encoding:
    """A tokenized document: the content tokens and where each one sits in the text."""

    ids: tuple[int, ...]
    offsets: tuple[tuple[int, int], ...]


class Tokenizer(Protocol):
    """The tokenizer surface preparation needs; nothing else."""

    cls_token_id: int
    sep_token_id: int
    special_token_count: int

    def encode(self, text: str) -> Encoding:
        """Token IDs without special tokens, plus each token's character span."""
        ...


class FastTokenizer:
    """Satisfies Tokenizer structurally; the only module that knows the HF calling convention."""

    def __init__(self, tokenizer: Any) -> None:
        self._tokenizer = tokenizer
        self.cls_token_id = tokenizer.cls_token_id
        self.sep_token_id = tokenizer.sep_token_id
        self.special_token_count = tokenizer.num_special_tokens_to_add(pair=False)

    def encode(self, text: str) -> Encoding:
        """Tokenize without special tokens and return each token's character span."""
        encoded = self._tokenizer(
            text,
            add_special_tokens=False,
            return_offsets_mapping=True,
            truncation=False,
        )
        return Encoding(
            ids=tuple(int(token) for token in encoded["input_ids"]),
            offsets=tuple(
                (int(start), int(end)) for start, end in encoded["offset_mapping"]
            ),
        )
