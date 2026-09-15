from abc import ABC, abstractmethod

from src.domain.models import BatcherHealthSnapshot


class IEngineHealthReporter(ABC):
    @abstractmethod
    def health_snapshot(self) -> BatcherHealthSnapshot: ...
