from abc import ABC, abstractmethod


class ITelemetryReporter(ABC):
    @abstractmethod
    def observe_document_plan(
        self, operation: str, model_name: str, input_chars: int, chunk_count: int
    ) -> None:
        """Record the initial planning of a document analysis request.

        Implementations must be non-blocking and must not raise.
        """

    @abstractmethod
    def track_document_chunk_started(self, operation: str, model_name: str) -> None:
        """Increment the counter for in-flight document chunks.

        Must be non-blocking and must not raise — caller will guard with try/except.
        """

    @abstractmethod
    def track_document_chunk_finished(self, operation: str, model_name: str) -> None:
        """Decrement the counter for in-flight document chunks.

        Must be non-blocking and must not raise.
        """

    @abstractmethod
    def record_document_chunk_processed(self, operation: str, model_name: str) -> None:
        """Increment the total processed chunks counter. Must not raise."""

    def record_document_chunk_failed(self, operation: str, model_name: str) -> None:
        """Record a failed chunk. Optional — default no-op, must not raise."""
        return
