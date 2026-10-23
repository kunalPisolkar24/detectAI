from abc import ABC, abstractmethod
from concurrent.futures import Future
from typing import Callable


class ExecutorPort(ABC):
    @abstractmethod
    def submit(self, fn: Callable, *args, **kwargs) -> Future: ...

    @abstractmethod
    def stats(self) -> tuple[int, int, int] | None: ...

    @abstractmethod
    def healthy(self) -> bool: ...
