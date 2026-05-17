from dataclasses import dataclass, field
from enum import Enum


class BatcherHealthStatus(str, Enum):
    INITIALIZING = "initializing"
    SERVING = "serving"
    SHUTTING_DOWN = "shutting_down"
    WORKER_UNAVAILABLE = "worker_unavailable"
    CIRCUIT_OPEN = "circuit_open"
    QUEUE_FULL = "queue_full"


@dataclass(frozen=True)
class BatcherHealthSnapshot:
    status: BatcherHealthStatus
    queue_size: int
    queue_capacity: int
    circuit_open_remaining: int | None = None

    @property
    def failure_reason(self) -> str | None:
        if self.status == BatcherHealthStatus.SERVING:
            return None
        if self.status == BatcherHealthStatus.INITIALIZING:
            return "service_initializing"
        if self.status == BatcherHealthStatus.SHUTTING_DOWN:
            return "shutdown_in_progress"
        if self.status == BatcherHealthStatus.WORKER_UNAVAILABLE:
            return "batch_worker_stopped"
        if self.status == BatcherHealthStatus.CIRCUIT_OPEN:
            return "inference_circuit_open"
        return "inference_queue_full"


@dataclass(frozen=True)
class DocumentChunk:
    index: int
    text: str
    token_count: int
    char_start: int
    char_end: int


@dataclass(frozen=True)
class DocumentProgress:
    processed_chunks: int
    total_chunks: int


@dataclass(frozen=True)
class DocumentStarted:
    total_chars: int
    total_chunks: int


@dataclass(frozen=True)
class HighlightSpan:
    char_start: int
    char_end: int
    ai_probability: float


@dataclass(frozen=True)
class DocumentScore:
    ai_probability: float
    total_chunks: int
    total_chars: int
    highlight_spans: list[HighlightSpan] = field(default_factory=list)
