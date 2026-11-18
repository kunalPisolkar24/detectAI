"""The HF tokenizer adapter: the only module that knows the HF calling convention."""

from typing import Any

from ..tokenizer import Encoding


class FastTokenizer:
    """Satisfies Tokenizer structurally; the only module that knows the HF calling convention."""

    def __init__(self, tokenizer: Any) -> None:
        self._tokenizer = tokenizer
        self.cls_token_id = tokenizer.cls_token_id
        self.sep_token_id = tokenizer.sep_token_id
        self.pad_token_id = tokenizer.pad_token_id
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
