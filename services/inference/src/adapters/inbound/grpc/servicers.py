import asyncio

import grpc
import structlog

from src.adapters.inbound.grpc.response_mapper import build_response, normalize_model_id
from src.adapters.inbound.grpc.streaming_presenter import StreamingPresenter
from src.application.ports.inbound.document_analysis import DocumentAnalysisUseCase
from src.domain.exceptions import InferenceError
from src.generated import ai_service_pb2_grpc

logger = structlog.get_logger()
_MAX_MODEL_ID_LEN = 64
_MAX_TEXT_LOG_LEN = 500


def _normalize_model_id(request) -> str:
    return normalize_model_id(request)


class AIService(ai_service_pb2_grpc.AIServiceServicer):
    def __init__(self, analysis_service: DocumentAnalysisUseCase, telemetry=None) -> None:
        self.analysis_service = analysis_service
        self.presenter = StreamingPresenter()
        self.telemetry = telemetry

    def _build_response(self, model_name: str, score):
        return build_response(model_name, score, self.telemetry)

    async def _ensure_model(self, context, model_key: str) -> None:
        if model_key not in self.analysis_service.engines:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                f"Unsupported analysis model: {model_key[:_MAX_MODEL_ID_LEN]}",
            )

    async def Detect(self, request, context):
        model_key = normalize_model_id(request)
        await self._ensure_model(context, model_key)
        try:
            score = await self.analysis_service.analyze(
                request.text, model_key, request_is_active=lambda: not context.done()
            )
            return self._build_response(model_key.capitalize(), score)
        except asyncio.CancelledError:
            logger.warning("grpc_client_disconnected", method="Detect")
            raise
        except Exception as e:
            await self._abort(context, e, model_key.capitalize())

    async def AnalyzeDocument(self, request, context):
        model_key = normalize_model_id(request)
        await self._ensure_model(context, model_key)
        model_name = model_key.capitalize()
        try:
            async for event in self.analysis_service.stream(
                request.text, model_key, request_is_active=lambda: not context.done()
            ):
                if context.done():
                    break
                if self.presenter.is_started(event):
                    yield self.presenter.build_started(event.total_chars, event.total_chunks)
                    continue
                if self.presenter.is_progress(event):
                    yield self.presenter.build_progress(event)
                    continue
                if self.presenter.is_final(event):
                    yield self.presenter.build_final(self._build_response(model_name, event))
                    continue
                raise InferenceError(f"Unknown stream event type: {type(event).__name__}")
        except asyncio.CancelledError:
            logger.warning("grpc_client_disconnected", method="AnalyzeDocument")
            raise
        except Exception as e:
            await self._abort(context, e, model_name)

    async def _abort(self, context, error: Exception, model_name: str):
        from src.domain.exceptions import InvalidInputError, ServiceOverloadedError

        if isinstance(error, (InvalidInputError, ValueError)):
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(error)[:_MAX_TEXT_LOG_LEN])
        elif isinstance(error, ServiceOverloadedError):
            logger.warning("inference_overloaded", model=model_name, error=str(error)[:_MAX_TEXT_LOG_LEN])
            await context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, str(error)[:_MAX_TEXT_LOG_LEN])
        else:
            logger.error("inference_error", model=model_name, error=str(error)[:_MAX_TEXT_LOG_LEN], exc_info=True)
            await context.abort(grpc.StatusCode.INTERNAL, "Internal Inference Error")
