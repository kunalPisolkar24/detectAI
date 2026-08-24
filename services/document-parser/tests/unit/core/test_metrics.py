import os
from unittest.mock import patch
from app.core.exceptions import (
    DocumentTooLargeError,
    ExtractionError,
    FileTooLargeError,
    UnsupportedFileTypeError,
)
from app.core.metrics import classify_extraction_error, render_metrics, record_extraction, record_extraction_failure


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
    assert classify_extraction_error(ExtractionError("boom")) == "corrupt_document"
    assert classify_extraction_error(ValueError("nope")) == "unexpected"
