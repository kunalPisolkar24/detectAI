from __future__ import annotations

import re
from typing import Protocol

from src.inference.document_types import DocumentChunk


class TokenChunker(Protocol):
    def chunk(self, text: str, chunk_size: int, stride: int, max_global_tokens: int) -> list[DocumentChunk]:
        ...


class RegexTokenChunker:
    _pattern = re.compile(r"\S+")

    def chunk(self, text: str, chunk_size: int, stride: int, max_global_tokens: int) -> list[DocumentChunk]:
        matches = list(self._pattern.finditer(text))
        if len(matches) > max_global_tokens:
            from src.core.exceptions import InvalidInputError
            raise InvalidInputError(f"Request exceeds hard limit of {max_global_tokens} tokens.")
        if not matches:
            return []

        chunks: list[DocumentChunk] = []
        index = 0
        step = max(1, stride)

        for start in range(0, len(matches), step):
            window = matches[start:start + chunk_size]
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
        self.tokenizer = tokenizer

    def chunk(self, text: str, chunk_size: int, stride: int, max_global_tokens: int) -> list[DocumentChunk]:
        encoding = self.tokenizer(
            text,
            add_special_tokens=False,
            return_offsets_mapping=True,
            truncation=False,
        )
        offsets = encoding.get("offset_mapping", [])
        if len(offsets) > max_global_tokens:
            from src.core.exceptions import InvalidInputError
            raise InvalidInputError(f"Request exceeds hard limit of {max_global_tokens} tokens.")
        if not offsets:
            return []

        chunks: list[DocumentChunk] = []
        index = 0
        step = max(1, stride)

        for start in range(0, len(offsets), step):
            window = offsets[start:start + chunk_size]
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
        self.chunker = chunker
        self.chunk_size = chunk_size
        self.stride = stride
        self.max_global_tokens = max_global_tokens

    def plan(self, text: str) -> list[DocumentChunk]:
        chunks = self.chunker.chunk(text, self.chunk_size, self.stride, self.max_global_tokens)
        if chunks:
            return chunks

        stripped = text.strip()
        if not stripped:
            return []

        return [
            DocumentChunk(
                index=0,
                text=stripped,
                token_count=1,
                char_start=text.find(stripped),
                char_end=text.find(stripped) + len(stripped),
            )
        ]


def build_chunk_planner(tokenizer, chunk_size: int, stride: int, max_global_tokens: int) -> ChunkPlanner:
    if callable(tokenizer):
        return ChunkPlanner(BertTokenChunker(tokenizer), chunk_size, stride, max_global_tokens)
    return ChunkPlanner(RegexTokenChunker(), chunk_size, stride, max_global_tokens)
