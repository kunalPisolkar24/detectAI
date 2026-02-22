import grpc
from src.generated import ai_service_pb2
from src.generated import ai_service_pb2_grpc
from src.core.interfaces import IInferenceEngine
from src.config import settings
from src.metrics import AI_CONFIDENCE_SCORE
import structlog

logger = structlog.get_logger()

class AIService(ai_service_pb2_grpc.AIServiceServicer):
    def __init__(self, spark_engine: IInferenceEngine, flare_engine: IInferenceEngine):
        self.spark = spark_engine
        self.flare = flare_engine

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

    def _validate(self, text: str, context):
        if not text or not text.strip():
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Text cannot be empty")
        if len(text) > settings.MAX_TEXT_LENGTH:
            return text[:settings.MAX_TEXT_LENGTH]
        return text

    def DetectSpark(self, request, context):
        text = self._validate(request.text, context)
        try:
            prob = self.spark.predict(text)
            return self._build_response("Spark", prob)
        except Exception as e:
            logger.error("inference_error", model="Spark", error=str(e))
            context.abort(grpc.StatusCode.INTERNAL, "Internal Inference Error")

    def DetectFlare(self, request, context):
        text = self._validate(request.text, context)
        try:
            prob = self.flare.predict(text)
            return self._build_response("Flare", prob)
        except Exception as e:
            logger.error("inference_error", model="Flare", error=str(e))
            context.abort(grpc.StatusCode.INTERNAL, "Internal Inference Error")