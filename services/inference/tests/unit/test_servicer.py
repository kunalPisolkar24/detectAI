import grpc
from src.core.exceptions import InvalidInputError
from src.inference.document_types import DocumentProgress, DocumentScore, DocumentStarted
from src.server.servicers import AIService
from src.generated import ai_service_pb2

def test_detect_spark_success(mock_analysis_service, grpc_context, mock_settings):
    mock_analysis_service.analyze.return_value = DocumentScore(ai_probability=0.95, total_chunks=1, total_chars=120)
    servicer = AIService(mock_analysis_service)
    
    request = ai_service_pb2.PredictRequest(text="generated content")
    response = servicer.DetectSpark(request, grpc_context)
    
    assert response.model_name == "Spark"
    assert response.label == "AI"
    assert response.is_ai_generated is True
    assert response.confidence_score == 95.0
    assert response.ai_confidence == 95.0
    assert response.human_confidence == 5.0
    mock_analysis_service.analyze.assert_called_once_with("generated content", "spark")

def test_detect_flare_human_success(mock_analysis_service, grpc_context, mock_settings):
    mock_analysis_service.analyze.return_value = DocumentScore(ai_probability=0.10, total_chunks=2, total_chars=240)
    servicer = AIService(mock_analysis_service)
    
    request = ai_service_pb2.PredictRequest(text="human content")
    response = servicer.DetectFlare(request, grpc_context)
    
    assert response.model_name == "Flare"
    assert response.label == "Human"
    assert response.is_ai_generated is False
    assert response.confidence_score == 90.0
    assert response.ai_confidence == 10.0
    assert response.human_confidence == 90.0

def test_validate_empty_text(mock_analysis_service, grpc_context, mock_settings):
    mock_analysis_service.analyze.side_effect = InvalidInputError("Text cannot be empty")
    servicer = AIService(mock_analysis_service)
    request = ai_service_pb2.PredictRequest(text="")
    
    servicer.DetectSpark(request, grpc_context)
    
    grpc_context.abort.assert_called_once_with(
        grpc.StatusCode.INVALID_ARGUMENT,
        "Text cannot be empty"
    )

def test_inference_exception_handling(mock_analysis_service, grpc_context, mock_settings):
    mock_analysis_service.analyze.side_effect = RuntimeError("GPU Boom")
    servicer = AIService(mock_analysis_service)
    request = ai_service_pb2.PredictRequest(text="valid")
    
    servicer.DetectSpark(request, grpc_context)
    
    grpc_context.abort.assert_called_once_with(
        grpc.StatusCode.INTERNAL, 
        "Internal Inference Error"
    )

def test_analyze_document_streams_events(mock_analysis_service, grpc_context, mock_settings):
    mock_analysis_service.stream.return_value = iter([
        DocumentStarted(total_chars=120, total_chunks=2),
        DocumentProgress(processed_chunks=1, total_chunks=2),
        DocumentProgress(processed_chunks=2, total_chunks=2),
        DocumentScore(ai_probability=0.85, total_chunks=2, total_chars=120),
    ])
    servicer = AIService(mock_analysis_service)

    request = ai_service_pb2.AnalyzeDocumentRequest(
        text="generated content",
        model=ai_service_pb2.ANALYSIS_MODEL_SPARK,
    )
    events = list(servicer.AnalyzeDocument(request, grpc_context))

    assert len(events) == 4
    assert events[0].started.total_chars == 120
    assert events[0].started.total_chunks == 2
    assert events[1].progress.processed_chunks == 1
    assert events[2].progress.processed_chunks == 2
    assert events[3].final.model_name == "Spark"
    assert events[3].final.ai_confidence == 85.0
