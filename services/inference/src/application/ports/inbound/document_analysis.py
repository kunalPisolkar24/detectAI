from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncGenerator, Callable, Optional

from src.domain.models import DocumentProgress, DocumentScore, DocumentStarted


class DocumentAnalysisUseCase(ABC):
    @abstractmethod
    async def analyze(
        self,
        text: str,
        model_key: str,
        request_is_active: Optional[Callable[[], bool]] = None,
    ) -> DocumentScore: ...

    @abstractmethod
    def stream(
        self,
        text: str,
        model_key: str,
        request_is_active: Optional[Callable[[], bool]] = None,
    ) -> AsyncGenerator[DocumentStarted | DocumentProgress | DocumentScore, None]: ...

    @abstractmethod
    async def shutdown(self) -> None: ...
