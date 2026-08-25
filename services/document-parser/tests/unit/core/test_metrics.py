import os
from unittest.mock import patch
from app.core.exceptions import (
    DocumentTooLargeError,
    ExtractionError,
    ExtractionTimeoutError,
    FileTooLargeError,
    UnsupportedFileTypeError,
)
from app.core.metrics import (
    classify_extraction_error,
    record_extraction_duration,
    record_extraction_timeout,
    render_metrics,
    record_extraction,
    record_extraction_failure,
)


def test_render_metrics_single_process():
    with patch.dict(os.environ, clear=True):
        payload, content_type = render_metrics()
        assert content_type == "text/plain; version=0.0.4; charset=utf-8"
        assert b"http_requests_total" in payload


def test_render_metrics_multi_process(mocker, tmp_path):
    mocker.patch.dict(os.environ, {"PROMETHEUS_MULTIPROC_DIR": str(tmp_path)})
    payload, content_type = render_metrics()
    assert content_type == "text/plain; version=0.0.4; charset=utf-8"


def test_record_extraction_success_increments_metrics():
    record_extraction(mime_type="application/pdf", file_size_bytes=1024, text_bytes=512)
    payload, _ = render_metrics()
    assert b"parsed_documents_total" in payload
    assert b"parsed_file_size_bytes" in payload
    assert b"extracted_text_bytes_total" in payload


def _metric_value(payload: bytes, series: str) -> float | None:
    for line in payload.decode().splitlines():
        if line.startswith(series + " "):
            return float(line.rsplit(" ", 1)[1])
    return None


def test_record_extraction_emits_size_and_ratio_histograms():
    record_extraction(mime_type="text/plain", file_size_bytes=2048, text_bytes=512)
    payload, _ = render_metrics()
    assert b'extracted_text_length_bytes_count{mime_type="text/plain"}' in payload
    assert b'extraction_compression_ratio_count{mime_type="text/plain"}' in payload


def test_record_extraction_skips_ratio_for_empty_text():
    before_ratio = _metric_value(render_metrics()[0], 'extraction_compression_ratio_sum{mime_type="text/plain"}')
    before_length_sum = _metric_value(render_metrics()[0], 'extracted_text_length_bytes_sum{mime_type="text/plain"}')

    record_extraction(mime_type="text/plain", file_size_bytes=2048, text_bytes=0)

    after_ratio = _metric_value(render_metrics()[0], 'extraction_compression_ratio_sum{mime_type="text/plain"}')
    after_length_sum = _metric_value(render_metrics()[0], 'extracted_text_length_bytes_sum{mime_type="text/plain"}')
    assert before_ratio is not None
    assert after_ratio == before_ratio
    assert before_length_sum is not None
    assert after_length_sum == before_length_sum


def test_record_extraction_duration_labels_status():
    record_extraction_duration(mime_type="application/pdf", status="success", duration_seconds=0.2)
    record_extraction_duration(mime_type="application/pdf", status="error", duration_seconds=0.4)
    payload, _ = render_metrics()
    assert b'extraction_duration_seconds_count{mime_type="application/pdf",status="success"} 1.0' in payload
    assert b'extraction_duration_seconds_count{mime_type="application/pdf",status="error"} 1.0' in payload
    assert b'extraction_duration_seconds_sum{mime_type="application/pdf",status="success"} 0.2' in payload


def test_record_extraction_failure_increments_error_counter():
    record_extraction_failure(mime_type="application/pdf", file_size_bytes=2048)
    payload, _ = render_metrics()
    assert b'parsed_documents_total{mime_type="application/pdf",status="error"}' in payload


def test_record_extraction_failure_labels_error_type():
    record_extraction_failure(mime_type="application/pdf", file_size_bytes=2048, error_type="corrupt_document")
    payload, _ = render_metrics()
    assert b'extraction_failures_total{error_type="corrupt_document",mime_type="application/pdf"}' in payload


def test_classify_extraction_error_categories():
    assert classify_extraction_error(FileTooLargeError(10, 5)) == "file_too_large"
    assert classify_extraction_error(DocumentTooLargeError(10, 5)) == "document_too_large"
    assert classify_extraction_error(UnsupportedFileTypeError("image/png")) == "unsupported_file_type"
    assert classify_extraction_error(ExtractionTimeoutError(30.0)) == "timeout"
    assert classify_extraction_error(ExtractionError("boom")) == "corrupt_document"
    assert classify_extraction_error(ValueError("nope")) == "unexpected"


def test_record_extraction_timeout_increments_counter():
    record_extraction_timeout(mime_type="application/pdf")
    payload, _ = render_metrics()
    assert b'extraction_timeouts_total{mime_type="application/pdf"}' in payload
