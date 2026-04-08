from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any, List

class BatcherHealthStatus(str, Enum):
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
        if self.status == BatcherHealthStatus.SHUTTING_DOWN:
            return "shutdown_in_progress"
        if self.status == BatcherHealthStatus.WORKER_UNAVAILABLE:
            return "batch_worker_stopped"
        if self.status == BatcherHealthStatus.CIRCUIT_OPEN:
            return "inference_circuit_open"
        return "inference_queue_full"


class IAsyncInferenceEngine(ABC):
    @abstractmethod
    async def predict(self, text: str) -> float:
        pass


class ISyncBatchInferenceEngine(ABC):
    @abstractmethod
    def predict_batch(self, texts: List[str]) -> List[float]:
        pass


class IEngineHealthReporter(ABC):
    @abstractmethod
    def health_snapshot(self) -> BatcherHealthSnapshot:
        pass


class IModelLoader(ABC):
    @abstractmethod
    def load(self, model_key: str) -> Any:
        pass
