from abc import ABC, abstractmethod


class ITelemetryReporter(ABC):
    @abstractmethod
    def observe_document_plan(
        self, operation: str, model_name: str, input_chars: int, chunk_count: int
    ) -> None: ...

    @abstractmethod
    def track_document_chunk_started(self, operation: str, model_name: str) -> None: ...

    @abstractmethod
    def track_document_chunk_finished(self, operation: str, model_name: str) -> None: ...

    @abstractmethod
    def record_document_chunk_processed(self, operation: str, model_name: str) -> None: ...

    def record_document_chunk_failed(
        self, operation: str, model_name: str, reason: str = "error"
    ) -> None:
        return

    def record_document_request(self, operation: str, model_name: str, status: str) -> None:
        return

    def record_queue_rejected(self, model_name: str, reason: str) -> None:
        return

    def record_batch_error(self, model_name: str, error_type: str) -> None:
        return

    def observe_queue_wait(self, model_name: str, seconds: float) -> None:
        return

    def record_provider_fallback(
        self, model_name: str, requested: str, active: str, trigger: str
    ) -> None:
        return

    def observe_confidence(self, model_name: str, ai_probability: float) -> None:
        return

    def record_auth_failure(self, method: str, reason: str) -> None:
        return

    def observe_grpc_request(
        self, method: str, code: str, model: str, duration: float
    ) -> None:
        return
