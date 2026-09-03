from __future__ import annotations

import re
from typing import Protocol

from src.domain.models import DocumentChunk


class TokenChunker(Protocol):
    def chunk(self, text: str, chunk_size: int, stride: int, max_global_tokens: int) -> list[DocumentChunk]:
        ...


class RegexTokenChunker:
    _pattern = re.compile(r"\S+")

    def chunk(self, text: str, chunk_size: int, stride: int, max_global_tokens: int) -> list[DocumentChunk]:
        if not isinstance(text, str):
            from src.domain.exceptions import InvalidInputError

            raise InvalidInputError("Text must be a string")
        if not isinstance(chunk_size, int) or chunk_size <= 0:
            raise ValueError("chunk_size must be an int >0")
        if not isinstance(stride, int) or stride <= 0:
            raise ValueError("stride must be an int >0")
        if not isinstance(max_global_tokens, int) or max_global_tokens <= 0:
            raise ValueError("max_global_tokens must be an int >0")
        matches = list(self._pattern.finditer(text))
        if len(matches) > max_global_tokens:
            from src.domain.exceptions import InvalidInputError

            raise InvalidInputError(f"Request exceeds hard limit of {max_global_tokens} tokens.")
        if not matches:
            return []

        chunks: list[DocumentChunk] = []
        index = 0
        step = stride

        for start in range(0, len(matches), step):
            window = matches[start : start + chunk_size]
            if not window:
                break

            char_start = window[0].start()
            char_end = window[-1].end()
            chunk_text = text[char_start:char_end]

            chunks.append(
                DocumentChunk(
                    index=index,
                    text=chunk_text,
                    token_count=len(window),
                    char_start=char_start,
                    char_end=char_end,
                )
            )
            index += 1

            if start + chunk_size >= len(matches):
                break

        return chunks


class BertTokenChunker:
    def __init__(self, tokenizer):
        if tokenizer is None or not callable(tokenizer):
            raise ValueError("BertTokenChunker requires a callable tokenizer")
        self.tokenizer = tokenizer

    def chunk(self, text: str, chunk_size: int, stride: int, max_global_tokens: int) -> list[DocumentChunk]:
        if not isinstance(text, str):
            from src.domain.exceptions import InvalidInputError

            raise InvalidInputError("Text must be a string")
        if not isinstance(chunk_size, int) or chunk_size <= 0:
            raise ValueError("chunk_size must be an int >0")
        if not isinstance(stride, int) or stride <= 0:
            raise ValueError("stride must be an int >0")
        if not isinstance(max_global_tokens, int) or max_global_tokens <= 0:
            raise ValueError("max_global_tokens must be an int >0")
        try:
            encoding = self.tokenizer(
                text,
                add_special_tokens=False,
                return_offsets_mapping=True,
                truncation=False,
            )
        except Exception as e:
            from src.domain.exceptions import InferenceError

            raise InferenceError(f"Tokenization failed: {e}") from e

        # HF tokenizers may return dict or tuple; handle robustly
        offsets = None
        if isinstance(encoding, dict):
            offsets = encoding.get("offset_mapping", [])
        elif isinstance(encoding, (list, tuple)) and encoding:
            # Fallback: try to get offsets from first element if needed
            offsets = []
        else:
            offsets = []

        # Filter None and zero-length offsets (special tokens)
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
        offsets = filtered

        if len(offsets) > max_global_tokens:
            from src.domain.exceptions import InvalidInputError

            raise InvalidInputError(f"Request exceeds hard limit of {max_global_tokens} tokens (got {len(offsets)}).")
        if not offsets:
            return []

        chunks: list[DocumentChunk] = []
        index = 0
        step = stride

        for start in range(0, len(offsets), step):
            window = offsets[start : start + chunk_size]
            if not window:
                break

            char_start = window[0][0]
            char_end = window[-1][1]
            if char_end <= char_start:
                continue

            chunks.append(
                DocumentChunk(
                    index=index,
                    text=text[char_start:char_end],
                    token_count=len(window),
                    char_start=char_start,
                    char_end=char_end,
                )
            )
            index += 1

            if start + chunk_size >= len(offsets):
                break

        return chunks


class ChunkPlanner:
    def __init__(self, chunker: TokenChunker, chunk_size: int, stride: int, max_global_tokens: int):
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
        self.max_chunks = 10000  # safety cap to avoid OOM in dispatcher/aggregation

    def plan(self, text: str) -> list[DocumentChunk]:
        if not isinstance(text, str):
            from src.domain.exceptions import InvalidInputError

            raise InvalidInputError("Text must be a string")
        chunks = self.chunker.chunk(text, self.chunk_size, self.stride, self.max_global_tokens)
        if chunks:
            if len(chunks) > self.max_chunks:
                from src.domain.exceptions import InvalidInputError

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


def build_chunk_planner(tokenizer, chunk_size: int, stride: int, max_global_tokens: int) -> ChunkPlanner:
    if tokenizer is None:
        raise ValueError("tokenizer is required")
    if callable(tokenizer):
        return ChunkPlanner(BertTokenChunker(tokenizer), chunk_size, stride, max_global_tokens)
    return ChunkPlanner(RegexTokenChunker(), chunk_size, stride, max_global_tokens)
