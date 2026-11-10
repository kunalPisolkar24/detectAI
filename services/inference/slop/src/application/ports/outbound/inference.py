from abc import ABC, abstractmethod
from typing import List

from src.application.ports.outbound.health import IEngineHealthReporter
from src.application.ports.outbound.model_loader import IModelLoader

__all__ = [
    "IAsyncInferenceEngine",
    "IEngineHealthReporter",
    "IModelLoader",
    "ISyncBatchInferenceEngine",
]


class IAsyncInferenceEngine(ABC):
    @abstractmethod
    async def predict(self, text: str) -> float: ...


class ISyncBatchInferenceEngine(ABC):
    @abstractmethod
    def predict_batch(self, texts: List[str]) -> List[float]: ...


# Re-export for backward compatibility
__all__ += ["IEngineHealthReporter", "IModelLoader"]
