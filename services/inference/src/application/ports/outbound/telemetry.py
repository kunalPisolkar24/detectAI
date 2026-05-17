from abc import ABC, abstractmethod


class ITelemetryReporter(ABC):
    @abstractmethod
    def observe_document_plan(
        self, operation: str, model_name: str, input_chars: int, chunk_count: int
    ) -> None:
        """Record the initial planning of a document analysis request."""
        ...

    @abstractmethod
    def track_document_chunk_started(self, operation: str, model_name: str) -> None:
        """Increment the counter for in-flight document chunks."""
        ...

    @abstractmethod
    def track_document_chunk_finished(self, operation: str, model_name: str) -> None:
        """Decrement the counter for in-flight document chunks."""
        ...

    @abstractmethod
    def record_document_chunk_processed(self, operation: str, model_name: str) -> None:
        """Increment the total processed chunks counter."""
        ...
