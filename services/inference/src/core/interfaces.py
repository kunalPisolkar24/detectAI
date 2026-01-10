from abc import ABC, abstractmethod
from typing import Any

class IInferenceEngine(ABC):
    @abstractmethod
    def predict(self, text: str) -> float:
        pass

class IModelLoader(ABC):
    @abstractmethod
    def load(self, model_key: str) -> Any:
        pass