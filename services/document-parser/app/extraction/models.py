"""The extraction vocabulary shared by every layer.

Deadline and ExtractionResult are the types the pipeline assembles, the
strategies receive and raise, and (when the route leg lands) the extract
endpoint maps onto HTTP. models.py is a leaf on purpose: strategies, the
service, the settings contract, and api/ all import it, nothing imports
back — the dependency direction stays one-way (outer to inner, never the
reverse).

The extraction defaults live here too, one source for the settings
fields that will resolve them and the pipeline that enforces them.
"""

from dataclasses import dataclass
from time import perf_counter

# The consume-first knobs (extraction.md): the budget the strategies
# check between pages and member elements, and the output cap the
# pipeline applies once after cleaning. Their whys live in cleaning.md
# and http.md decision 6.
DEFAULT_PROCESSING_BUDGET_SECONDS = 10.0
DEFAULT_OUTPUT_CHAR_LIMIT = 1_000_000

# The six phase-1 cleaning knobs (cleaning.md): the thresholds rule (a)
# and rule (b) delete on, single-sourced here so the settings contract
# and the pdf strategy read one truth. The settings validators enforce
# their ranges — fail-boot, never a silent fallback.
DEFAULT_HEADER_REPETITION_RATIO = 0.8
DEFAULT_REPETITION_MIN_PAGES = 4
DEFAULT_HEADER_EDGE_ZONE_RATIO = 0.20
DEFAULT_EDGE_ZONE_RATIO = 0.10
DEFAULT_EDGE_TOLERANCE_RATIO = 0.02
DEFAULT_FOLIO_MONOTONIC_RATIO = 0.70


@dataclass(frozen=True, slots=True)
class Deadline:
    """The processing budget, frozen at creation (extraction.md).

    The deadline is a monotonic expiry, not a remaining count: strategies
    call expired() between steps — between pdf pages and docx member
    elements — and that check is the whole timeout story on a synchronous
    path, so the largest possible overshoot is one step's work.
    """

    _expires_at: float

    @classmethod
    def from_budget(cls, seconds: float) -> "Deadline":
        """A deadline `seconds` away on the monotonic clock."""
        return cls(_expires_at=perf_counter() + seconds)

    def expired(self) -> bool:
        """Whether the budget is spent; the clock is read fresh on
        every call."""
        return perf_counter() >= self._expires_at


@dataclass(frozen=True, slots=True)
class ExtractionResult:
    """The pipeline's output: cleaned text and the cap's verdict.

    truncated is the one flag http.md decision 6 asks for; pages that
    yield nothing inside an otherwise extractable document set it the
    same way the char cap does — there is no second wire field.
    """

    text: str
    truncated: bool


@dataclass(frozen=True, slots=True)
class RawLines:
    """A strategy's raw ordered lines, plus its one honesty fact.

    partial says some of the document was skipped as unreadable — the
    fact the pipeline folds into truncated (http.md decision 6: "not
    the complete extractable text"). Pages that read cleanly and simply
    hold no text are not partial: they carry no extractable text to
    lose, so an empty-but-readable page never flags.
    """

    lines: list[str]
    partial: bool


@dataclass(frozen=True, slots=True)
class CleaningKnobs:
    """The six phase-1 cleaning thresholds (cleaning.md).

    A frozen carrier: the pdf strategy reads them, tests build them
    explicitly, and the boot validated every range before one exists —
    an out-of-range value kills the boot instead of loosening a
    deletion rule (cleaning.md's deliberate strictness).
    """

    header_repetition_ratio: float = DEFAULT_HEADER_REPETITION_RATIO
    repetition_min_pages: int = DEFAULT_REPETITION_MIN_PAGES
    header_edge_zone_ratio: float = DEFAULT_HEADER_EDGE_ZONE_RATIO
    edge_zone_ratio: float = DEFAULT_EDGE_ZONE_RATIO
    edge_tolerance_ratio: float = DEFAULT_EDGE_TOLERANCE_RATIO
    folio_monotonic_ratio: float = DEFAULT_FOLIO_MONOTONIC_RATIO


class ExtractionError(Exception):
    """The typed failure vocabulary; the route maps it onto HTTP."""


class BudgetExhaustedError(ExtractionError):
    """The budget ran out between pages or member elements; the 504
    stays generic because the wire cannot say which page (http.md)."""


class UnreadableDocumentError(ExtractionError):
    """Content failing after admission — a container the parser cannot
    open, XML that explodes mid-stream, a scanned pdf's zero text; the
    422 stays generic because a failing file cannot be branded (http.md)."""
