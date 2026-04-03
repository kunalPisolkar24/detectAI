from dataclasses import dataclass


@dataclass(frozen=True)
class DocumentChunk:
    index: int
    text: str
    token_count: int
    char_start: int
    char_end: int


@dataclass(frozen=True)
class DocumentProgress:
    processed_chunks: int
    total_chunks: int


@dataclass(frozen=True)
class DocumentStarted:
    total_chars: int
    total_chunks: int


@dataclass(frozen=True)
class DocumentScore:
    ai_probability: float
    total_chunks: int
    total_chars: int
