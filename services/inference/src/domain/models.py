import math
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
        if self.status == BatcherHealthStatus.QUEUE_FULL:
            return "inference_queue_full"
        return "unknown"


@dataclass(frozen=True)
class DocumentChunk:
    index: int
    text: str
    token_count: int
    char_start: int
    char_end: int

    def __post_init__(self) -> None:
        if not isinstance(self.index, int) or self.index < 0:
            raise ValueError("DocumentChunk.index must be >=0")
        if not isinstance(self.text, str) or not self.text:
            raise ValueError("DocumentChunk.text must be non-empty str")
        if not isinstance(self.token_count, int) or self.token_count <= 0:
            raise ValueError("DocumentChunk.token_count must be >0")
        if not isinstance(self.char_start, int) or self.char_start < 0:
            raise ValueError("DocumentChunk.char_start must be >=0")
        if not isinstance(self.char_end, int) or self.char_end <= self.char_start:
            raise ValueError("DocumentChunk.char_end must be > char_start")


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

    def __post_init__(self) -> None:
        if not isinstance(self.char_start, int) or self.char_start < 0:
            raise ValueError("HighlightSpan.char_start must be >=0")
        if not isinstance(self.char_end, int) or self.char_end <= self.char_start:
            raise ValueError("HighlightSpan.char_end must be > char_start")
        if not isinstance(self.ai_probability, (int, float)) or not math.isfinite(self.ai_probability):
            raise ValueError("HighlightSpan.ai_probability must be finite")
        if not 0.0 <= float(self.ai_probability) <= 1.0:
            raise ValueError("HighlightSpan.ai_probability must be in [0,1]")


@dataclass(frozen=True)
class DocumentScore:
    ai_probability: float
    total_chunks: int
    total_chars: int
    highlight_spans: tuple[HighlightSpan, ...] = field(default_factory=tuple)  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if not isinstance(self.ai_probability, (int, float)) or not math.isfinite(self.ai_probability):
            raise ValueError("DocumentScore.ai_probability must be finite")
        if not 0.0 <= float(self.ai_probability) <= 1.0:
            raise ValueError("DocumentScore.ai_probability must be in [0,1]")
        if not isinstance(self.total_chunks, int) or self.total_chunks <= 0:
            raise ValueError("DocumentScore.total_chunks must be >0")
        if not isinstance(self.total_chars, int) or self.total_chars < 0:
            raise ValueError("DocumentScore.total_chars must be >=0")
        # Normalize highlight_spans to tuple for immutability (frozen shallow)
        if isinstance(self.highlight_spans, list):
            object.__setattr__(self, "highlight_spans", tuple(self.highlight_spans))  # type: ignore[attr-defined]
        elif not isinstance(self.highlight_spans, tuple):
            raise ValueError("highlight_spans must be list or tuple")
        for span in self.highlight_spans:
            if not isinstance(span, HighlightSpan):
                raise ValueError("highlight_spans must contain HighlightSpan")
