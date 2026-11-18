"""The wire boundary: the contract's messages from the plane's own results."""

from ..inference.analysis import AnalysisFinished, AnalysisProgress, AnalysisStarted
from ..inference.postprocessing import DocumentVerdict
from .generated import ai_service_pb2 as pb

# The model the contract serves when a request names none.
DEFAULT_MODEL_ID = "spark"

# The progress events a document may carry: one per this many completed chunks.
MAX_PROGRESS_EVENTS = 20


def normalize_model_id(raw: str) -> str:
    """The canonical key: the client's spelling folded, the default when empty.

    The contract promises no case normalization, so this is a courtesy rather
    than a promise: the response still echoes the canonical key.
    """
    return (raw or "").strip().lower() or DEFAULT_MODEL_ID


def to_detection_result(model_id: str, verdict: DocumentVerdict) -> pb.DetectionResult:
    """The verdict on the wire: percentages, and the confidence mirrors the winner."""
    ai_confidence = _percentage(verdict.ai_probability)
    human_confidence = _percentage(verdict.human_probability)
    return pb.DetectionResult(
        model_id=model_id,
        is_ai_generated=verdict.is_ai_generated,
        confidence_score=ai_confidence if verdict.is_ai_generated else human_confidence,
        ai_confidence=ai_confidence,
        human_confidence=human_confidence,
        highlight_spans=[
            pb.HighlightSpan(
                char_start=span.char_start,
                char_end=span.char_end,
                ai_confidence=_percentage(span.ai_probability),
            )
            for span in verdict.spans
        ],
    )


def to_started_event(event: AnalysisStarted) -> pb.AnalyzeDocumentEvent:
    return pb.AnalyzeDocumentEvent(
        started=pb.AnalyzeDocumentStarted(
            total_chars=event.total_chars,
            total_chunks=event.total_chunks,
        )
    )


def to_progress_event(event: AnalysisProgress) -> pb.AnalyzeDocumentEvent:
    return pb.AnalyzeDocumentEvent(
        progress=pb.AnalyzeDocumentProgress(
            processed_chunks=event.processed_chunks,
            total_chunks=event.total_chunks,
        )
    )


def to_result_event(model_id: str, event: AnalysisFinished) -> pb.AnalyzeDocumentEvent:
    return pb.AnalyzeDocumentEvent(result=to_detection_result(model_id, event.verdict))


def should_send_progress(event: AnalysisProgress, last_sent: int) -> bool:
    """The contract's coalescing: one event per twentieth of the document, the last always."""
    if event.processed_chunks >= event.total_chunks:
        return True
    if event.processed_chunks <= last_sent:
        return False
    step = max(1, event.total_chunks // MAX_PROGRESS_EVENTS)
    return event.processed_chunks - last_sent >= step


def _percentage(probability: float) -> float:
    """The contract's unit: a 0-100 percentage rounded to one decimal."""
    return round(probability * 100, 1)
