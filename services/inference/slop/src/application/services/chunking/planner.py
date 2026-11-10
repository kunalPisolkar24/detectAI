from src.application.services.chunking.protocol import TokenChunker
from src.domain.exceptions import InvalidInputError
from src.domain.models import DocumentChunk


class ChunkPlanner:
    def __init__(
        self, chunker: TokenChunker, chunk_size: int, stride: int, max_global_tokens: int
    ) -> None:
        if chunker is None:
            raise ValueError("chunker is required")
        if not isinstance(chunk_size, int) or chunk_size <= 0:
            raise ValueError("chunk_size must be an int >0")
        if not isinstance(stride, int) or stride <= 0:
            raise ValueError("stride must be an int >0")
        if not isinstance(max_global_tokens, int) or max_global_tokens <= 0:
            raise ValueError("max_global_tokens must be an int >0")
        if stride > chunk_size:
            raise ValueError("stride must be <= chunk_size")
        self.chunker = chunker
        self.chunk_size = chunk_size
        self.stride = stride
        self.max_global_tokens = max_global_tokens
        self.max_chunks = 10000

    def plan(self, text: str) -> list[DocumentChunk]:
        if not isinstance(text, str):
            raise InvalidInputError("Text must be a string")
        chunks = self.chunker.chunk(
            text, self.chunk_size, self.stride, self.max_global_tokens
        )
        if chunks:
            if len(chunks) > self.max_chunks:
                raise InvalidInputError(f"Too many chunks {len(chunks)} > {self.max_chunks}")
            return chunks

        stripped = text.strip()
        if not stripped:
            return []
        start = text.find(stripped)
        if start == -1:
            start = 0
        return [
            DocumentChunk(
                index=0,
                text=stripped,
                token_count=1,
                char_start=start,
                char_end=start + len(stripped),
            )
        ]
