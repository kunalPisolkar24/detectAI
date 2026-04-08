from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest

from src.core.exceptions import InvalidInputError, ServiceOverloadedError
from src.generated import ai_service_pb2
from src.inference.document_types import DocumentProgress, DocumentScore, DocumentStarted
from src.server.servicers import AIService


async def collect_events(stream):
    return [event async for event in stream]


@pytest.mark.asyncio
async def test_detect_success(grpc_context):
    analysis_service = MagicMock()
    analysis_service.engines = {"spark": object()}
    analysis_service.analyze = AsyncMock(
        return_value=DocumentScore(ai_probability=0.95, total_chunks=1, total_chars=120)
    )
    servicer = AIService(analysis_service)

    request = ai_service_pb2.PredictRequest(text="generated content", model_id="spark")
    response = await servicer.Detect(request, grpc_context)

    assert response.model_name == "Spark"
    assert response.label == "AI"
    assert response.is_ai_generated is True
    assert response.confidence_score == 95.0
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
        yield DocumentScore(ai_probability=0.85, total_chunks=2, total_chars=120)

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
