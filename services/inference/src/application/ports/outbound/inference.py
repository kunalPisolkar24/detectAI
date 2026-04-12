from abc import ABC, abstractmethod
from typing import Any, List
from src.domain.models import BatcherHealthSnapshot


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
