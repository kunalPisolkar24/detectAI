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
    IN_FLIGHT_REQUESTS,
    classify_extraction_error,
    is_process_pool_healthy,
    record_extraction_duration,
    record_extraction_queue_wait,
    record_extraction_timeout,
    record_rejected_upload,
    refresh_process_pool_gauges,
    register_process_pool,
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


def test_record_rejected_upload_reasons():
    payload_before, _ = render_metrics()

    record_rejected_upload(FileTooLargeError(10, 5))
    record_rejected_upload(DocumentTooLargeError(10, 5))
    record_rejected_upload(UnsupportedFileTypeError("image/png"))

    payload_after, _ = render_metrics()
    assert (
        _metric_value(payload_after, 'rejected_uploads_total{reason="too_large"}')
        - _metric_value(payload_before, 'rejected_uploads_total{reason="too_large"}')
    ) == 2.0
    assert (
        _metric_value(payload_after, 'rejected_uploads_total{reason="unsupported_type"}')
        - _metric_value(payload_before, 'rejected_uploads_total{reason="unsupported_type"}')
    ) == 1.0


def test_record_rejected_upload_ignores_non_rejections():
    before = _metric_value(render_metrics()[0], 'rejected_uploads_total{reason="too_large"}')
    record_rejected_upload(ExtractionError("boom"))
    after = _metric_value(render_metrics()[0], 'rejected_uploads_total{reason="too_large"}')
    assert before is not None
    assert after == before


def test_in_flight_requests_gauge_tracks_inc_dec():
    IN_FLIGHT_REQUESTS.inc(3)
    payload, _ = render_metrics()
    assert b"in_flight_requests 3.0" in payload
    IN_FLIGHT_REQUESTS.dec(3)
    payload, _ = render_metrics()
    assert b"in_flight_requests" in payload


def test_refresh_process_pool_gauges_reports_pool_state(mocker):
    from unittest.mock import MagicMock

    mock_pool = MagicMock()
    mock_pool._threads = {"t1", "t2"}
    mock_pool._work_queue.qsize.return_value = 7
    mock_pool._max_workers = 4

    register_process_pool(mock_pool)
    try:
        payload, _ = render_metrics()
        assert b"extraction_pool_active_threads 2.0" in payload
        assert b"extraction_pool_queue_depth 7.0" in payload
        assert b"extraction_pool_max_workers 4.0" in payload
    finally:
        register_process_pool(None)


def test_refresh_process_pool_gauges_without_pool_is_noop():
    register_process_pool(None)
    refresh_process_pool_gauges()


def test_record_extraction_queue_wait_samples_histogram():
    record_extraction_queue_wait(mime_type="application/pdf", wait_seconds=0.02)
    payload, _ = render_metrics()
    assert b'extraction_queue_wait_seconds_count{mime_type="application/pdf"}' in payload


def test_is_process_pool_healthy_states():
    from unittest.mock import MagicMock

    healthy_pool = MagicMock()
    healthy_pool._shutdown = False
    register_process_pool(healthy_pool)
    assert is_process_pool_healthy() is True

    shutdown_pool = MagicMock()
    shutdown_pool._shutdown = True
    register_process_pool(shutdown_pool)
    assert is_process_pool_healthy() is False

    register_process_pool(None)
    assert is_process_pool_healthy() is False
