from abc import ABC, abstractmethod


class MimeDetectorPort(ABC):
    @abstractmethod
    def detect(self, header: bytes) -> str: ...
