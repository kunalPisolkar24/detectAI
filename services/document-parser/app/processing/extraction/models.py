"""The extraction vocabulary and the single-sourced defaults."""

from dataclasses import dataclass
from time import perf_counter

# The consume-first knobs (extraction.md).
DEFAULT_PROCESSING_BUDGET_SECONDS = 10.0
DEFAULT_OUTPUT_CHAR_LIMIT = 1_000_000

# Six cleaning thresholds, single-sourced; settings range checks are fail-boot.
DEFAULT_HEADER_REPETITION_RATIO = 0.8
DEFAULT_REPETITION_MIN_PAGES = 4
DEFAULT_HEADER_EDGE_ZONE_RATIO = 0.20
DEFAULT_EDGE_ZONE_RATIO = 0.10
DEFAULT_EDGE_TOLERANCE_RATIO = 0.02
DEFAULT_FOLIO_MONOTONIC_RATIO = 0.70


@dataclass(frozen=True, slots=True)
class Deadline:
    """A monotonic expiry checked between steps; overshoot is one step's work."""

    _expires_at: float

    @classmethod
    def from_budget(cls, seconds: float) -> "Deadline":
        """A deadline `seconds` away on the monotonic clock."""
        return cls(_expires_at=perf_counter() + seconds)

    def expired(self) -> bool:
        return perf_counter() >= self._expires_at


@dataclass(frozen=True, slots=True)
class ExtractionResult:
    """Cleaned text plus the cap's verdict; truncated is the one wire flag."""

    text: str
    truncated: bool


@dataclass(frozen=True, slots=True)
class RawLines:
    """partial: some document was skipped unreadable (folded into truncated)."""

    lines: list[str]
    partial: bool


@dataclass(frozen=True, slots=True)
class CleaningKnobs:
    header_repetition_ratio: float = DEFAULT_HEADER_REPETITION_RATIO
    repetition_min_pages: int = DEFAULT_REPETITION_MIN_PAGES
    header_edge_zone_ratio: float = DEFAULT_HEADER_EDGE_ZONE_RATIO
    edge_zone_ratio: float = DEFAULT_EDGE_ZONE_RATIO
    edge_tolerance_ratio: float = DEFAULT_EDGE_TOLERANCE_RATIO
    folio_monotonic_ratio: float = DEFAULT_FOLIO_MONOTONIC_RATIO


class ExtractionError(Exception):
    """The typed failure vocabulary; the route maps it onto HTTP."""


class BudgetExhaustedError(ExtractionError):
    """504 stays generic: the wire cannot say which page."""


class UnreadableDocumentError(ExtractionError):
    """Content failing after admission; the 422 stays generic — nothing to brand."""
