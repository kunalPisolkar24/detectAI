"""The results of one aggregation: the region in, the span out, and the verdict."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ScoredRegion:
    """One scored region of a document, and the AI probability the engine gave it."""

    char_start: int
    char_end: int
    scored_tokens: int
    ai_probability: float


@dataclass(frozen=True)
class HighlightSpan:
    """One region's place in the request text, and its own AI probability."""

    char_start: int
    char_end: int
    ai_probability: float


@dataclass(frozen=True)
class DocumentVerdict:
    """One document's verdict: the flag, both sides, and the regions that produced them."""

    is_ai_generated: bool
    ai_probability: float
    human_probability: float
    spans: tuple[HighlightSpan, ...]
