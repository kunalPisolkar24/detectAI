import re

from src.domain.exceptions import InvalidInputError
from src.domain.models import DocumentChunk

from src.application.services.chunking.sliding_window import (
    build_sliding_chunks,
    validate_chunk_params,
)


class RegexTokenChunker:
    _pattern = re.compile(r"\S+")

    def chunk(
        self, text: str, chunk_size: int, stride: int, max_global_tokens: int
    ) -> list[DocumentChunk]:
        if not isinstance(text, str):
            raise InvalidInputError("Text must be a string")
        validate_chunk_params(chunk_size, stride, max_global_tokens)

        matches = list(self._pattern.finditer(text))
        if len(matches) > max_global_tokens:
            raise InvalidInputError(
                f"Request exceeds hard limit of {max_global_tokens} tokens."
            )
        if not matches:
            return []

        offsets = [(m.start(), m.end()) for m in matches]
        return build_sliding_chunks(text, offsets, chunk_size, stride)
