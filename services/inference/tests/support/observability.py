"""A recording stand-in for the observability seam: the use-case tests read
what the service reported without an SDK in the room."""

from collections.abc import Iterator
from contextlib import contextmanager


class RecordingObservability:
    """Records every seam call; the shape mirrors the contract exactly."""

    def __init__(self) -> None:
        self.models: list[tuple[str, str, str]] = []
        self.failures: list[str] = []
        self.document_brackets = 0
        self.open_document_brackets = 0
        self.batches: list[int] = []
        self.open_batches = 0
        self.engine_durations: list[tuple[str, float]] = []
        self.shutdowns = 0

    def annotate_model(self, model_id: str, revision: str, provider: str) -> None:
        self.models.append((model_id, revision, provider))

    def mark_failed(self, reason: str) -> None:
        self.failures.append(reason)

    @contextmanager
    def track_document(self) -> Iterator[None]:
        self.document_brackets += 1
        self.open_document_brackets += 1
        try:
            yield
        finally:
            self.open_document_brackets -= 1

    @contextmanager
    def track_batch(self, size: int) -> Iterator[None]:
        self.batches.append(size)
        self.open_batches += 1
        try:
            yield
        finally:
            self.open_batches -= 1

    def record_engine_duration(self, model_id: str, seconds: float) -> None:
        self.engine_durations.append((model_id, seconds))

    def shutdown(self) -> None:
        self.shutdowns += 1
