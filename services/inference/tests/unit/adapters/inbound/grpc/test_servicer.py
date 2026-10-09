from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest

from src.domain.exceptions import InvalidInputError, ServiceOverloadedError
from src.generated import ai_service_pb2
from src.domain.models import DocumentProgress, DocumentScore, DocumentStarted, HighlightSpan
from src.adapters.inbound.grpc.servicers import AIService


async def collect_events(stream):
    return [event async for event in stream]


@pytest.mark.asyncio
async def test_detect_success(grpc_context):
    analysis_service = MagicMock()
    analysis_service.engines = {"spark": object()}
    analysis_service.analyze = AsyncMock(
        return_value=DocumentScore(
            ai_probability=0.95,
            total_chunks=1,
            total_chars=120,
            highlight_spans=[HighlightSpan(char_start=0, char_end=20, ai_probability=0.95)],
        )
    )
    servicer = AIService(analysis_service)

    request = ai_service_pb2.PredictRequest(text="generated content", model_id="spark")
    response = await servicer.Detect(request, grpc_context)

    assert response.model_name == "Spark"
    assert response.label == "AI"
    assert response.is_ai_generated is True
    assert response.confidence_score == 95.0
    assert len(response.highlight_spans) == 1
    assert response.highlight_spans[0].char_start == 0
    assert response.highlight_spans[0].char_end == 20
    assert response.highlight_spans[0].ai_confidence == 95.0
    analysis_service.analyze.assert_awaited_once()


@pytest.mark.asyncio
async def test_detect_maps_invalid_input_to_invalid_argument(grpc_context):
    analysis_service = MagicMock()
    analysis_service.engines = {"spark": object()}
    analysis_service.analyze = AsyncMock(side_effect=InvalidInputError("Text cannot be empty"))
    servicer = AIService(analysis_service)

    request = ai_service_pb2.PredictRequest(text="", model_id="spark")

    with pytest.raises(Exception, match="Text cannot be empty"):
        await servicer.Detect(request, grpc_context)

    assert grpc_context.aborts == [
        (grpc.StatusCode.INVALID_ARGUMENT, "Text cannot be empty")
    ]


@pytest.mark.asyncio
async def test_detect_maps_overload_to_resource_exhausted(grpc_context):
    analysis_service = MagicMock()
    analysis_service.engines = {"spark": object()}
    analysis_service.analyze = AsyncMock(side_effect=ServiceOverloadedError("spark overloaded"))
    servicer = AIService(analysis_service)

    request = ai_service_pb2.PredictRequest(text="generated", model_id="spark")

    with pytest.raises(Exception, match="spark overloaded"):
        await servicer.Detect(request, grpc_context)

    assert grpc_context.aborts == [
        (grpc.StatusCode.RESOURCE_EXHAUSTED, "spark overloaded")
    ]


@pytest.mark.asyncio
async def test_analyze_document_streams_events(grpc_context):
    analysis_service = MagicMock()
    analysis_service.engines = {"spark": object()}

    async def stream(*args, **kwargs):
        yield DocumentStarted(total_chars=120, total_chunks=2)
        yield DocumentProgress(processed_chunks=1, total_chunks=2)
        yield DocumentProgress(processed_chunks=2, total_chunks=2)
        yield DocumentScore(
            ai_probability=0.85,
            total_chunks=2,
            total_chars=120,
            highlight_spans=[HighlightSpan(char_start=10, char_end=30, ai_probability=0.85)],
        )

    analysis_service.stream = stream
    servicer = AIService(analysis_service)

    request = ai_service_pb2.AnalyzeDocumentRequest(
        text="generated content",
        model_id="spark",
    )
    events = await collect_events(servicer.AnalyzeDocument(request, grpc_context))

    assert len(events) == 4
    assert events[0].started.total_chars == 120
    assert events[1].progress.processed_chunks == 1
    assert events[2].progress.processed_chunks == 2
    assert events[3].final.model_name == "Spark"
    assert events[3].final.ai_confidence == 85.0
    assert len(events[3].final.highlight_spans) == 1
    assert events[3].final.highlight_spans[0].char_start == 10
    assert events[3].final.highlight_spans[0].char_end == 30


@pytest.mark.asyncio
async def test_analyze_document_rejects_unknown_model(grpc_context):
    analysis_service = MagicMock()
    analysis_service.engines = {"spark": object()}
    servicer = AIService(analysis_service)

    request = ai_service_pb2.AnalyzeDocumentRequest(
        text="generated content",
        model_id="unknown",
    )

    with pytest.raises(Exception, match="Unsupported analysis model: unknown"):
        await collect_events(servicer.AnalyzeDocument(request, grpc_context))

    assert grpc_context.aborts == [
        (grpc.StatusCode.INVALID_ARGUMENT, "Unsupported analysis model: unknown")
    ]


@pytest.mark.asyncio
async def test_analyze_document_coalesces_progress_for_large_documents(grpc_context):
    total = 52
    analysis_service = MagicMock()
    analysis_service.engines = {"spark": object()}

    async def stream(*args, **kwargs):
        yield DocumentStarted(total_chars=1000, total_chunks=total)
        for processed in range(1, total + 1):
            yield DocumentProgress(processed_chunks=processed, total_chunks=total)
        yield DocumentScore(ai_probability=0.6, total_chunks=total, total_chars=1000, highlight_spans=[])

    analysis_service.stream = stream
    servicer = AIService(analysis_service)

    request = ai_service_pb2.AnalyzeDocumentRequest(text="large document", model_id="spark")
    events = await collect_events(servicer.AnalyzeDocument(request, grpc_context))

    progress = [e.progress.processed_chunks for e in events if e.HasField("progress")]
    assert progress == list(range(2, total + 1, 2))
    assert events[0].HasField("started")
    assert events[-1].HasField("final")


def test_should_send_progress_boundaries():
    from src.adapters.inbound.grpc.servicers import _should_send_progress

    assert _should_send_progress(1, 1, 0) is True
    assert _should_send_progress(2, 2, 0) is True
    assert _should_send_progress(1, 2, 0) is True
    assert _should_send_progress(1, 52, 0) is False
    assert _should_send_progress(2, 52, 0) is True
    assert _should_send_progress(2, 52, 2) is False
    assert _should_send_progress(52, 52, 50) is True
