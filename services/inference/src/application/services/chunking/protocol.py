from typing import Protocol

from src.domain.models import DocumentChunk


class TokenChunker(Protocol):
    def chunk(
        self, text: str, chunk_size: int, stride: int, max_global_tokens: int
    ) -> list[DocumentChunk]: ...
