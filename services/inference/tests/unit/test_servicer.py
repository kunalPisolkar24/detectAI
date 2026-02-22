import grpc
from src.server.servicers import AIService
from src.generated import ai_service_pb2

def test_detect_spark_success(mock_engine, grpc_context, mock_settings):
    mock_engine.predict.return_value = 0.95
    servicer = AIService(spark_engine=mock_engine, flare_engine=mock_engine)
    
    request = ai_service_pb2.PredictRequest(text="generated content")
    response = servicer.DetectSpark(request, grpc_context)
    
    assert response.model_name == "Spark"
    assert response.label == "AI"
    assert response.is_ai_generated is True
    assert response.confidence_score == 95.0
    assert response.ai_confidence == 95.0
    assert response.human_confidence == 5.0
    mock_engine.predict.assert_called_once_with("generated content")

def test_detect_flare_human_success(mock_engine, grpc_context, mock_settings):
    mock_engine.predict.return_value = 0.10
    servicer = AIService(spark_engine=mock_engine, flare_engine=mock_engine)
    
    request = ai_service_pb2.PredictRequest(text="human content")
    response = servicer.DetectFlare(request, grpc_context)
    
    assert response.model_name == "Flare"
    assert response.label == "Human"
    assert response.is_ai_generated is False
    assert response.confidence_score == 90.0
    assert response.ai_confidence == 10.0
    assert response.human_confidence == 90.0

def test_validate_empty_text(mock_engine, grpc_context, mock_settings):
    servicer = AIService(spark_engine=mock_engine, flare_engine=mock_engine)
    request = ai_service_pb2.PredictRequest(text="")
    
    servicer.DetectSpark(request, grpc_context)
    
    grpc_context.abort.assert_called_once_with(
        grpc.StatusCode.INVALID_ARGUMENT, 
        "Text cannot be empty"
    )

def test_validate_truncates_text(mock_engine, grpc_context, mock_settings):
    mock_settings.MAX_TEXT_LENGTH = 5
    servicer = AIService(spark_engine=mock_engine, flare_engine=mock_engine)
    request = ai_service_pb2.PredictRequest(text="123456789")
    
    servicer.DetectSpark(request, grpc_context)
    
    mock_engine.predict.assert_called_once_with("12345")

def test_inference_exception_handling(mock_engine, grpc_context, mock_settings):
    mock_engine.predict.side_effect = RuntimeError("GPU Boom")
    servicer = AIService(spark_engine=mock_engine, flare_engine=mock_engine)
    request = ai_service_pb2.PredictRequest(text="valid")
    
    servicer.DetectSpark(request, grpc_context)
    
    grpc_context.abort.assert_called_once_with(
        grpc.StatusCode.INTERNAL, 
        "Internal Inference Error"
    )