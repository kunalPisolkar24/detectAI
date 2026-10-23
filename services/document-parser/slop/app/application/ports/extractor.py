from abc import ABC, abstractmethod

from app.domain.entities import ExtractionResult


class ExtractorPort(ABC):
    @abstractmethod
    def extract(self, file_path: str) -> ExtractionResult: ...
