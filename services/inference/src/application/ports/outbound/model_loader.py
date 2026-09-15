from abc import ABC, abstractmethod
from typing import Any


class IModelLoader(ABC):
    @abstractmethod
    def load(self, model_key: str) -> Any: ...
