from src.domain.models import DocumentScore
from src.generated import ai_service_pb2

_MAX_MODEL_ID_LEN = 64
_MAX_TEXT_LOG_LEN = 500


def normalize_model_id(request) -> str:
    raw = getattr(request, "model_id", "") or ""
    if len(raw) > _MAX_MODEL_ID_LEN:
        raw = raw[:_MAX_MODEL_ID_LEN]
    return raw.strip().lower() or "spark"


def build_response(model_name: str, score: DocumentScore, telemetry=None):
    ai_prob = score.ai_probability
    if telemetry is not None:
        try:
            telemetry.observe_confidence(model_name.lower(), ai_prob)
        except Exception:
            pass
    else:
        try:
            from src.infrastructure.metrics import AI_CONFIDENCE_SCORE

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
                char_start=s.char_start,
                char_end=s.char_end,
                ai_confidence=round(s.ai_probability * 100, 1),
            )
            for s in score.highlight_spans
        ],
    )


def map_error_to_status(error: Exception):
    from src.domain.exceptions import InvalidInputError, ServiceOverloadedError

    if isinstance(error, (InvalidInputError, ValueError)):
        return "INVALID_ARGUMENT", str(error)[:_MAX_TEXT_LOG_LEN]
    if isinstance(error, ServiceOverloadedError):
        return "RESOURCE_EXHAUSTED", str(error)[:_MAX_TEXT_LOG_LEN]
    return "INTERNAL", "Internal Inference Error"
