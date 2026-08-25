import pytest
import os
from unittest.mock import MagicMock
from app.domain.extraction.service import ExtractionService
from app.domain.extraction.strategies import ExtractionResult


def test_process_file_success(mocker):
    mock_strategy = MagicMock()
    mock_strategy.extract.return_value = ExtractionResult(text="Mocked Raw Text")
    mocker.patch("app.domain.extraction.service.ExtractorFactory.get_strategy", return_value=mock_strategy)
    mocker.patch("app.domain.extraction.service.TextCleaner.clean", return_value="Cleaned Text")
    mock_record = mocker.patch("app.domain.extraction.service.record_extraction")
    mock_record_duration = mocker.patch("app.domain.extraction.service.record_extraction_duration")

    mock_file = MagicMock()
    mock_file.filename = "test.txt"
    mock_file.file.read.return_value = b"Dummy Content"

    result = ExtractionService.process_file(mock_file, "text/plain")

    assert result.text == "Cleaned Text"
    assert result.truncated is False
    mock_strategy.extract.assert_called_once()
    mock_record.assert_called_once_with(
        mime_type="text/plain",
        file_size_bytes=len(b"Dummy Content"),
        text_bytes=len("Cleaned Text".encode("utf-8")),
    )
    mock_record_duration.assert_called_once_with(
        mime_type="text/plain",
        status="success",
        duration_seconds=mock_record_duration.call_args.kwargs["duration_seconds"],
    )

    called_path = mock_strategy.extract.call_args[0][0]
    assert called_path.endswith(".txt")
    assert not os.path.exists(called_path)


def test_process_file_records_failed_extraction_duration(mocker):
    from app.core.exceptions import ExtractionError

    mock_strategy = MagicMock()
    mock_strategy.extract.side_effect = ExtractionError("PDF processing failed: bad xref")
    mocker.patch("app.domain.extraction.service.ExtractorFactory.get_strategy", return_value=mock_strategy)
    mocker.patch("app.domain.extraction.service.record_extraction_failure")
    mock_record_duration = mocker.patch("app.domain.extraction.service.record_extraction_duration")

    mock_file = MagicMock()
    mock_file.filename = "broken.pdf"
    mock_file.file.read.return_value = b"%PDF-broken"

    with pytest.raises(ExtractionError):
        ExtractionService.process_file(mock_file, "application/pdf")

    duration_call = mock_record_duration.call_args
    assert duration_call.kwargs["status"] == "error"
    assert duration_call.kwargs["mime_type"] == "application/pdf"
    assert duration_call.kwargs["duration_seconds"] >= 0


def test_process_file_preserves_truncation_flag(mocker):
    mock_strategy = MagicMock()
    mock_strategy.extract.return_value = ExtractionResult(text="Partial text", truncated=True)
    mocker.patch("app.domain.extraction.service.ExtractorFactory.get_strategy", return_value=mock_strategy)
    mocker.patch("app.domain.extraction.service.TextCleaner.clean", side_effect=lambda t: t)

    mock_file = MagicMock()
    mock_file.filename = "broken.pdf"
    mock_file.file.read.return_value = b"%PDF-partial"

    result = ExtractionService.process_file(mock_file, "application/pdf")

    assert result.text == "Partial text"
    assert result.truncated is True


def test_run_extraction_task_records_queue_wait_and_delegates(mocker):
    import time
    from app.domain.extraction.service import run_extraction_task

    mock_record_wait = mocker.patch("app.domain.extraction.service.record_extraction_queue_wait")
    mocker.patch("app.domain.extraction.service.refresh_process_pool_gauges")
    mock_process = mocker.patch(
        "app.domain.extraction.service.ExtractionService.process_file",
        return_value="delegated",
    )

    mock_file = MagicMock()
    submitted_at = time.perf_counter() - 0.05

    result = run_extraction_task(mock_file, "text/plain", submitted_at)

    assert result == "delegated"
    wait_call = mock_record_wait.call_args
    assert wait_call.kwargs["mime_type"] == "text/plain"
    assert 0.04 <= wait_call.kwargs["wait_seconds"] <= 1.0
    mock_process.assert_called_once_with(mock_file, "text/plain")


def test_process_file_too_large(mocker):
    from app.core.exceptions import FileTooLargeError
    import app.domain.extraction.service as svc

    mocker.patch.object(svc.settings, "MAX_UPLOAD_SIZE_BYTES", 100)

    mock_file = MagicMock()
    mock_file.filename = "large.txt"
    mock_file.file.read.return_value = b"x" * 101

    with pytest.raises(FileTooLargeError) as exc_info:
        ExtractionService.process_file(mock_file, "text/plain")

    assert "exceeds limit" in str(exc_info.value)


def test_process_file_cleanup_on_error(mocker):
    mock_strategy = MagicMock()
    mock_strategy.extract.side_effect = Exception("Parsing Failed")
    mocker.patch("app.domain.extraction.service.ExtractorFactory.get_strategy", return_value=mock_strategy)
    mock_record_failure = mocker.patch("app.domain.extraction.service.record_extraction_failure")

    mock_file = MagicMock()
    mock_file.filename = "test.pdf"
    mock_file.file.read.return_value = b"Dummy PDF Content"

    with pytest.raises(Exception) as exc_info:
        ExtractionService.process_file(mock_file, "application/pdf")

    assert str(exc_info.value) == "Parsing Failed"
    mock_record_failure.assert_called_once_with(
        mime_type="application/pdf",
        file_size_bytes=len(b"Dummy PDF Content"),
        error_type="unexpected",
    )

    called_path = mock_strategy.extract.call_args[0][0]
    assert not os.path.exists(called_path)


def test_process_file_records_corrupt_document_error_type(mocker):
    from app.core.exceptions import ExtractionError

    mock_strategy = MagicMock()
    mock_strategy.extract.side_effect = ExtractionError("PDF processing failed: bad xref")
    mocker.patch("app.domain.extraction.service.ExtractorFactory.get_strategy", return_value=mock_strategy)
    mock_record_failure = mocker.patch("app.domain.extraction.service.record_extraction_failure")

    mock_file = MagicMock()
    mock_file.filename = "broken.pdf"
    mock_file.file.read.return_value = b"%PDF-broken"

    with pytest.raises(ExtractionError):
        ExtractionService.process_file(mock_file, "application/pdf")

    mock_record_failure.assert_called_once_with(
        mime_type="application/pdf",
        file_size_bytes=len(b"%PDF-broken"),
        error_type="corrupt_document",
    )


def test_process_file_records_file_too_large_error_type(mocker):
    from app.core.exceptions import FileTooLargeError
    import app.domain.extraction.service as svc

    mocker.patch.object(svc.settings, "MAX_UPLOAD_SIZE_BYTES", 100)
    mock_record_failure = mocker.patch("app.domain.extraction.service.record_extraction_failure")

    mock_file = MagicMock()
    mock_file.filename = "large.txt"
    mock_file.file.read.return_value = b"x" * 101

    with pytest.raises(FileTooLargeError):
        ExtractionService.process_file(mock_file, "text/plain")

    mock_record_failure.assert_called_once_with(
        mime_type="text/plain",
        file_size_bytes=101,
        error_type="file_too_large",
    )
