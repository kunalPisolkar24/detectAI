"""The RPC surface: Detect (unary) and AnalyzeDocument (server-streaming)."""

import logging
from typing import NoReturn

import grpc
from grpc import aio

from ..inference.analysis import (
    AnalysisFinished,
    AnalysisProgress,
    AnalysisStarted,
    DocumentAnalysis,
)
from ..inference.errors import InferenceError, OverloadedError, UnknownModelError
from ..inference.preprocessing import InvalidDocument
from .generated import ai_service_pb2 as pb
from .generated import ai_service_pb2_grpc as pb_grpc
from .mapper import (
    normalize_model_id,
    should_send_progress,
    to_detection_result,
    to_progress_event,
    to_result_event,
    to_started_event,
)

logger = logging.getLogger(__name__)

# The internal fault's detail: the client learns nothing the contract owes it.
_INTERNAL_DETAIL = "Internal Inference Error"

# The client-visible detail's cap: the reason is the caller's own input.
_MAX_DETAIL_CHARS = 500


class AIServiceServicer(pb_grpc.AIServiceServicer):
    """The contract's two RPCs over the analysis use case."""

    def __init__(self, analysis: DocumentAnalysis) -> None:
        self._analysis = analysis

    async def Detect(
        self, request: pb.DetectRequest, context: aio.ServicerContext
    ) -> pb.DetectionResult:
        """One document in, one verdict out."""
        model_id = normalize_model_id(request.model_id)
        try:
            verdict = await self._analysis.analyze(request.text, model_id)
        except Exception as error:  # noqa: BLE001 - every failure has a contract status
            await self._abort(context, error)
        return to_detection_result(model_id, verdict)

    async def AnalyzeDocument(
        self, request: pb.AnalyzeDocumentRequest, context: aio.ServicerContext
    ):
        """One document in, the progress of its chunks and then its verdict out."""
        model_id = normalize_model_id(request.model_id)
        last_sent = 0
        try:
            async for event in self._analysis.stream(request.text, model_id):
                if isinstance(event, AnalysisStarted):
                    yield to_started_event(event)
                elif isinstance(event, AnalysisProgress):
                    if should_send_progress(event, last_sent):
                        last_sent = event.processed_chunks
                        yield to_progress_event(event)
                elif isinstance(event, AnalysisFinished):
                    yield to_result_event(model_id, event)
                else:
                    raise InferenceError(f"unknown analysis event: {type(event).__name__}")
        except Exception as error:  # noqa: BLE001 - every failure has a contract status
            await self._abort(context, error)

    async def _abort(self, context: aio.ServicerContext, error: Exception) -> NoReturn:
        """The error on the wire: the contract's code, and only what the caller owns."""
        code, detail = _status_for(error)
        if code is grpc.StatusCode.INTERNAL:
            logger.error("inference failed: %s", error, exc_info=error)
        await context.abort(code, detail)


def _status_for(error: Exception) -> tuple[grpc.StatusCode, str]:
    """The contract's error semantics: bad input, shed load, or an internal fault."""
    if isinstance(error, (InvalidDocument, UnknownModelError)):
        return grpc.StatusCode.INVALID_ARGUMENT, str(error)[:_MAX_DETAIL_CHARS]
    if isinstance(error, OverloadedError):
        return grpc.StatusCode.RESOURCE_EXHAUSTED, str(error)[:_MAX_DETAIL_CHARS]
    return grpc.StatusCode.INTERNAL, _INTERNAL_DETAIL
