"""The app-facing seam: protocol + disabled realization, no OTel imports.

The Literals are the metric contract: a new attribution value lands here
first, then in the inventory it feeds.
"""

from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from typing import Literal, Protocol

RejectionReason = Literal["too_large", "unsupported_type", "corrupt", "malformed"]
ExtractionOutcome = Literal["ok", "truncated", "timeout", "unreadable"]


class Observability(Protocol):
    """Exception-safe context managers, not begin/end pairs: a raise still closes the bracket."""

    def track_request(self) -> AbstractContextManager[None]:
        """Requests in flight, not successes."""
        ...

    def track_extraction(
        self, mime_type: str, document_size_bytes: int
    ) -> AbstractContextManager[None]:
        ...

    def record_rejection(self, reason: RejectionReason) -> None:
        ...

    def record_extraction(
        self, mime_type: str, outcome: ExtractionOutcome, duration_seconds: float
    ) -> None:
        ...

    def shutdown(self) -> None:
        ...


class NullObservability:
    """Zero SDK objects: the route keeps one code path with no endpoint branches."""

    @contextmanager
    def track_request(self) -> Iterator[None]:
        yield

    @contextmanager
    def track_extraction(
        self, mime_type: str, document_size_bytes: int
    ) -> Iterator[None]:
        yield  # no span exists to open when nothing is installed

    def record_rejection(self, reason: RejectionReason) -> None:
        pass

    def record_extraction(
        self, mime_type: str, outcome: ExtractionOutcome, duration_seconds: float
    ) -> None:
        pass

    def shutdown(self) -> None:
        pass
