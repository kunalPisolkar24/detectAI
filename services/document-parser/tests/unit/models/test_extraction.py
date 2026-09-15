import pytest
from pydantic import ValidationError

from app.models.extraction import ExtractionResponse, HealthCheck


def test_extraction_response_full_construction():
    response = ExtractionResponse(
        filename="doc.pdf",
        content_type="application/pdf",
        text_length=11,
        text="hello world",
        truncated=True,
    )

    assert response.filename == "doc.pdf"
    assert response.text_length == 11
    assert response.truncated is True


def test_extraction_response_truncated_defaults_false():
    response = ExtractionResponse(filename="a.txt", content_type="text/plain", text_length=0, text="")
    assert response.truncated is False


def test_extraction_response_requires_core_fields():
    with pytest.raises(ValidationError):
        ExtractionResponse(filename="only.pdf")


def test_health_check_defaults_to_ok_payload_shape():
    health = HealthCheck(status="ok")
    assert health.model_dump() == {"status": "ok"}


def test_health_check_accepts_arbitrary_status_strings():
    assert HealthCheck(status="not_ready").status == "not_ready"
