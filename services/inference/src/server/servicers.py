import grpc
from src.generated import ai_service_pb2
from src.generated import ai_service_pb2_grpc
from src.core.exceptions import InvalidInputError, ServiceOverloadedError
from src.inference.document_analysis import DocumentAnalysisService
from src.metrics import AI_CONFIDENCE_SCORE
from src.server.streaming_presenter import StreamingPresenter
import structlog

logger = structlog.get_logger()

class AIService(ai_service_pb2_grpc.AIServiceServicer):
    MODEL_MAP = {
        ai_service_pb2.ANALYSIS_MODEL_SPARK: "spark",
        ai_service_pb2.ANALYSIS_MODEL_FLARE: "flare",
    }

    def __init__(self, analysis_service: DocumentAnalysisService):
        self.analysis_service = analysis_service
        self.presenter = StreamingPresenter()

    def _build_response(self, model_name: str, ai_prob: float):
        AI_CONFIDENCE_SCORE.labels(model=model_name.lower()).observe(ai_prob)
        
        human_prob = 1.0 - ai_prob
        is_ai = ai_prob > 0.5
        
        return ai_service_pb2.PredictResponse(
            model_name=model_name,
            label="AI" if is_ai else "Human",
            is_ai_generated=is_ai,
            confidence_score=round((ai_prob if is_ai else human_prob) * 100, 1),
            human_confidence=round(human_prob * 100, 1),
            ai_confidence=round(ai_prob * 100, 1)
        )

    def DetectSpark(self, request, context):
        try:
            score = self.analysis_service.analyze(request.text, "spark")
            return self._build_response("Spark", score.ai_probability)
        except Exception as e:
            self._abort(context, e, "Spark")

    def DetectFlare(self, request, context):
        try:
            score = self.analysis_service.analyze(request.text, "flare")
            return self._build_response("Flare", score.ai_probability)
        except Exception as e:
            self._abort(context, e, "Flare")

    def AnalyzeDocument(self, request, context):
        model_key = self.MODEL_MAP.get(request.model)
        if model_key is None:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Unsupported analysis model")

        model_name = "Spark" if model_key == "spark" else "Flare"

        try:
            for event in self.analysis_service.stream(request.text, model_key):
                if self.presenter.is_started(event):
                    yield self.presenter.build_started(event.total_chars, event.total_chunks)
                    continue

                if self.presenter.is_progress(event):
                    yield self.presenter.build_progress(event)
                    continue

                if self.presenter.is_final(event):
                    yield self.presenter.build_final(self._build_response(model_name, event.ai_probability))
        except Exception as e:
            self._abort(context, e, model_name)

    def _abort(self, context, error: Exception, model_name: str):
        if isinstance(error, InvalidInputError):
            return context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(error))

        if isinstance(error, ServiceOverloadedError):
            logger.warning("inference_overloaded", model=model_name, error=str(error))
            return context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, str(error))

        logger.error("inference_error", model=model_name, error=str(error))
        context.abort(grpc.StatusCode.INTERNAL, "Internal Inference Error")
