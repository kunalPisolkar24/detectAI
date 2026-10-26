"""The app-facing seam: one protocol, one disabled realization, no OTel imports.

Everything outside this package depends on the names this module exports —
the route sees only this seam on app.state, per observability.md's
dependency view. The vocabularies are frozen Literals because the attribution
vocabularies are the metric contract: a new reason or outcome lands here
first, then in the inventory it feeds.
"""

from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from typing import Literal, Protocol

RejectionReason = Literal["too_large", "unsupported_type", "corrupt", "malformed"]
ExtractionOutcome = Literal["ok", "truncated", "timeout", "unreadable"]


class Observability(Protocol):
    """Four verdict recordings plus shutdown — the five-method seam.

    track_request and track_extraction are exception-safe context managers,
    not begin/end pairs: an early raise leaves the bracket closed, nothing
    to forget. shutdown rides the seam because the object on
    app.state.observability is the one main.py drains.
    """

    def track_request(self) -> AbstractContextManager[None]:
        """Bracket the whole handler — rejections included: the gauge counts
        requests in flight, not successes."""
        ...

    def track_extraction(
        self, mime_type: str, document_size_bytes: int
    ) -> AbstractContextManager[None]:
        """Carry the extraction span with the mime and document-size
        attributes under its span; still closes on a raise."""
        ...

    def record_rejection(self, reason: RejectionReason) -> None:
        """rejected_uploads_total, one add per verdict, reason attributed."""
        ...

    def record_extraction(
        self, mime_type: str, outcome: ExtractionOutcome, duration_seconds: float
    ) -> None:
        """One call per attempt; the realization owns the instrument fold."""
        ...

    def shutdown(self) -> None:
        """Drain the three signals; idempotent."""
        ...


class NullObservability:
    """The disabled build: every call a no-op, nothing installed.

    Zero SDK objects — stronger than meters that could still export — so the
    route keeps one code path with no `if endpoint` branches anywhere
    (observability.md's disabled boot). This is what every endpoint-less boot
    runs, and it is fully functional by design.
    """

    @contextmanager
    def track_request(self) -> Iterator[None]:
        yield

    @contextmanager
    def track_extraction(
        self, mime_type: str, document_size_bytes: int
    ) -> Iterator[None]:
        yield  # no span exists to open when nothing is installed

    def record_rejection(self, reason: RejectionReason) -> None:
        """No instrument exists to record onto."""

    def record_extraction(
        self, mime_type: str, outcome: ExtractionOutcome, duration_seconds: float
    ) -> None:
        """No instruments exist to fold the outcome onto."""

    def shutdown(self) -> None:
        """Nothing installed, nothing to drain."""
