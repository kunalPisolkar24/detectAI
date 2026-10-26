"""A recording realization of the observability seam for route-level tests.

The route depends only on the contract protocol, so a test swaps
app.state.observability for this stub and sees exactly what the route
records — while the facade's own tests assert what each recording lands
on (in-memory exporters there, captured calls here).
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import NamedTuple

from app.observability.contract import ExtractionOutcome, RejectionReason


class ExtractionCall(NamedTuple):
    mime_type: str
    outcome: ExtractionOutcome
    duration_seconds: float


class RecordingObservability:
    """Same five-method shape as Observability; every call lands in a list."""

    def __init__(self) -> None:
        self.rejections: list[RejectionReason] = []
        self.extractions: list[ExtractionCall] = []
        self.request_brackets = 0
        self.extraction_brackets: list[str] = []
        self.open_brackets = 0

    @contextmanager
    def track_request(self) -> Iterator[None]:
        self.request_brackets += 1
        self.open_brackets += 1
        try:
            yield
        finally:
            self.open_brackets -= 1

    @contextmanager
    def track_extraction(self, mime_type: str) -> Iterator[None]:
        self.extraction_brackets.append(mime_type)
        self.open_brackets += 1
        try:
            yield
        finally:
            self.open_brackets -= 1

    def record_rejection(self, reason: RejectionReason) -> None:
        self.rejections.append(reason)

    def record_extraction(
        self, mime_type: str, outcome: ExtractionOutcome, duration_seconds: float
    ) -> None:
        self.extractions.append(ExtractionCall(mime_type, outcome, duration_seconds))

    def shutdown(self) -> None:
        return None
