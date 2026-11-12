"""The generated contract: package, RPC surface, and message shapes pinned against drift."""

from app.serving.generated import ai_service_pb2 as pb
from app.serving.generated import ai_service_pb2_grpc as pb_grpc


def _service():
    return pb.DESCRIPTOR.services_by_name["AIService"]


def test_the_contract_serves_inference_v1() -> None:
    assert pb.DESCRIPTOR.package == "inference.v1"


def test_detect_is_unary_and_returns_the_shared_result() -> None:
    detect = _service().methods_by_name["Detect"]
    assert (detect.input_type.full_name, detect.output_type.full_name) == (
        "inference.v1.DetectRequest",
        "inference.v1.DetectionResult",
    )


def test_analyze_document_streams_the_event_envelope() -> None:
    analyze = _service().methods_by_name["AnalyzeDocument"]
    assert (analyze.input_type.full_name, analyze.output_type.full_name) == (
        "inference.v1.AnalyzeDocumentRequest",
        "inference.v1.AnalyzeDocumentEvent",
    )


def test_both_requests_carry_text_and_model_id() -> None:
    for message in ("DetectRequest", "AnalyzeDocumentRequest"):
        fields = pb.DESCRIPTOR.message_types_by_name[message].fields_by_name
        assert set(fields) == {"text", "model_id"}


def test_the_result_is_lean_and_echoes_the_model_id() -> None:
    assert set(pb.DetectionResult.DESCRIPTOR.fields_by_name) == {
        "model_id",
        "is_ai_generated",
        "confidence_score",
        "ai_confidence",
        "human_confidence",
        "highlight_spans",
    }


def test_the_event_stream_is_started_progress_result() -> None:
    oneof = pb.AnalyzeDocumentEvent.DESCRIPTOR.oneofs_by_name["event"]
    assert [field.name for field in oneof.fields] == ["started", "progress", "result"]


def test_a_span_is_char_offsets_plus_ai_confidence() -> None:
    assert set(pb.HighlightSpan.DESCRIPTOR.fields_by_name) == {
        "char_start",
        "char_end",
        "ai_confidence",
    }


def test_the_generated_grpc_stub_resolves_its_pb2_module() -> None:
    assert pb_grpc.AIServiceStub is not None
