from abc import ABC, abstractmethod


class FileStorePort(ABC):
    @abstractmethod
    def save(self, content: bytes, suffix: str) -> str: ...

    @abstractmethod
    def cleanup(self, path: str) -> None: ...
