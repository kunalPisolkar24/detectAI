from src.domain.exceptions import InferenceError, InvalidInputError
from src.domain.models import DocumentChunk

from src.application.services.chunking.sliding_window import (
    build_sliding_chunks,
    validate_chunk_params,
)


class BertTokenChunker:
    def __init__(self, tokenizer) -> None:
        if tokenizer is None or not callable(tokenizer):
            raise ValueError("BertTokenChunker requires a callable tokenizer")
        self.tokenizer = tokenizer

    def chunk(
        self, text: str, chunk_size: int, stride: int, max_global_tokens: int
    ) -> list[DocumentChunk]:
        if not isinstance(text, str):
            raise InvalidInputError("Text must be a string")
        validate_chunk_params(chunk_size, stride, max_global_tokens)

        try:
            encoding = self.tokenizer(
                text,
                add_special_tokens=False,
                return_offsets_mapping=True,
                truncation=False,
            )
        except Exception as e:
            raise InferenceError(f"Tokenization failed: {e}") from e

        offsets: list = []
        if isinstance(encoding, dict):
            offsets = encoding.get("offset_mapping", [])
        elif isinstance(encoding, (list, tuple)) and encoding:
            offsets = []

        filtered: list[tuple[int, int]] = []
        for off in offsets:
            if off is None:
                continue
            try:
                start, end = off
            except Exception:
                continue
            if start is None or end is None:
                continue
            if not isinstance(start, int) or not isinstance(end, int):
                continue
            if end <= start:
                continue
            filtered.append((start, end))

        if len(filtered) > max_global_tokens:
            raise InvalidInputError(
                f"Request exceeds hard limit of {max_global_tokens} tokens (got {len(filtered)})."
            )
        if not filtered:
            return []

        return build_sliding_chunks(text, filtered, chunk_size, stride)
