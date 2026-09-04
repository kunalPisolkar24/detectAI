import asyncio

import grpc
from src.generated import ai_service_pb2
from src.generated import ai_service_pb2_grpc
from src.domain.exceptions import InvalidInputError, ServiceOverloadedError
from src.application.services.document_analysis import DocumentAnalysisService
from src.domain.exceptions import InferenceError
from src.infrastructure.metrics import AI_CONFIDENCE_SCORE
from src.adapters.inbound.grpc.streaming_presenter import StreamingPresenter
import structlog

logger = structlog.get_logger()
_MAX_MODEL_ID_LEN = 64
_MAX_TEXT_LOG_LEN = 500


def _normalize_model_id(request) -> str:
    raw = getattr(request, "model_id", "") or ""
    # Truncate early to avoid 64MB lower() DoS
    if len(raw) > _MAX_MODEL_ID_LEN:
        raw = raw[:_MAX_MODEL_ID_LEN]
    return raw.strip().lower() or "spark"


class AIService(ai_service_pb2_grpc.AIServiceServicer):
    def __init__(self, analysis_service: DocumentAnalysisService):
        self.analysis_service = analysis_service
        self.presenter = StreamingPresenter()

    def _build_response(self, model_name: str, score):
        ai_prob = score.ai_probability
        try:
            AI_CONFIDENCE_SCORE.labels(model=model_name.lower()).observe(ai_prob)
        except Exception:
            pass

        human_prob = 1.0 - ai_prob
        is_ai = ai_prob > 0.5

        return ai_service_pb2.PredictResponse(
            model_name=model_name,
            label="AI" if is_ai else "Human",
            is_ai_generated=is_ai,
            confidence_score=round((ai_prob if is_ai else human_prob) * 100, 1),
            human_confidence=round(human_prob * 100, 1),
            ai_confidence=round(ai_prob * 100, 1),
            highlight_spans=[
                ai_service_pb2.HighlightSpan(
                    char_start=span.char_start,
                    char_end=span.char_end,
                    ai_confidence=round(span.ai_probability * 100, 1),
                )
                for span in score.highlight_spans
            ],
        )

    async def Detect(self, request, context):
        model_key = _normalize_model_id(request)
        if model_key not in self.analysis_service.engines:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"Unsupported analysis model: {model_key[:_MAX_MODEL_ID_LEN]}")

        try:
            score = await self.analysis_service.analyze(
                request.text,
                model_key,
                request_is_active=lambda: not context.done(),
            )
            return self._build_response(model_key.capitalize(), score)
        except asyncio.CancelledError:
            logger.warning("grpc_client_disconnected", method="Detect")
            raise
        except Exception as e:
            await self._abort(context, e, model_key.capitalize())

    async def AnalyzeDocument(self, request, context):
        model_key = _normalize_model_id(request)
        if model_key not in self.analysis_service.engines:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"Unsupported analysis model: {model_key[:_MAX_MODEL_ID_LEN]}")

        model_name = model_key.capitalize()

        try:
            async for event in self.analysis_service.stream(
                request.text,
                model_key,
                request_is_active=lambda: not context.done(),
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

                # Unknown event type — fail fast instead of silent drop
                raise InferenceError(f"Unknown stream event type: {type(event).__name__}")
        except asyncio.CancelledError:
            logger.warning("grpc_client_disconnected", method="AnalyzeDocument")
            raise
        except Exception as e:
            await self._abort(context, e, model_name)

    async def _abort(self, context, error: Exception, model_name: str):
        if isinstance(error, (InvalidInputError, ValueError)):
            # Map pipeline ValueError (unknown model, no chunks, misaligned) to INVALID_ARGUMENT
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(error)[:_MAX_TEXT_LOG_LEN])
        elif isinstance(error, ServiceOverloadedError):
            logger.warning("inference_overloaded", model=model_name, error=str(error)[:_MAX_TEXT_LOG_LEN])
            await context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, str(error)[:_MAX_TEXT_LOG_LEN])
        else:
            logger.error("inference_error", model=model_name, error=str(error)[:_MAX_TEXT_LOG_LEN], exc_info=True)
            await context.abort(grpc.StatusCode.INTERNAL, "Internal Inference Error")
