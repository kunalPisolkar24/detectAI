"""The app-facing seam: protocol + disabled realization, no OTel imports.

The use case injects this, never the SDK: the domain must not know that
telemetry exists, and a boot without an endpoint must install nothing.
"""

from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from typing import Protocol


class Observability(Protocol):
    """Exception-safe context managers, not begin/end pairs: a raise still closes the bracket."""

    def annotate_model(self, model_id: str, revision: str, provider: str) -> None:
        """Fold the serving model onto the live span; the board facets on it."""
        ...

    def mark_failed(self, reason: str) -> None:
        """Mark the live span failed; the board's error share counts it."""
        ...

    def track_document(self) -> AbstractContextManager[None]:
        """Documents in flight, not successes."""
        ...

    def track_batch(self, size: int) -> AbstractContextManager[None]:
        """One engine call: its width, and the chunks it holds."""
        ...

    def record_engine_duration(self, model_id: str, seconds: float) -> None:
        """The forward pass of one batch, for the per-model percentiles."""
        ...

    def shutdown(self) -> None:
        ...


class NullObservability:
    """Zero SDK objects: the use case keeps one code path with no endpoint branches."""

    def annotate_model(self, model_id: str, revision: str, provider: str) -> None:
        pass

    def mark_failed(self, reason: str) -> None:
        pass

    @contextmanager
    def track_document(self) -> Iterator[None]:
        yield

    @contextmanager
    def track_batch(self, size: int) -> Iterator[None]:
        yield  # no gauge exists to open when nothing is installed

    def record_engine_duration(self, model_id: str, seconds: float) -> None:
        pass

    def shutdown(self) -> None:
        pass
