from abc import ABC, abstractmethod
from typing import Any, List

class IInferenceEngine(ABC):
    @abstractmethod
    def predict(self, text: str) -> float:
        pass

    @abstractmethod
    def predict_batch(self, texts: List[str]) -> List[float]:
        pass

class IModelLoader(ABC):
    @abstractmethod
    def load(self, model_key: str) -> Any:
        pass