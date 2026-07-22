import pytest
import os
from unittest.mock import MagicMock
from app.domain.extraction.service import ExtractionService


def test_process_file_success(mocker):
    mock_strategy = MagicMock()
    mock_strategy.extract.return_value = "Mocked Raw Text"
    mocker.patch("app.domain.extraction.service.ExtractorFactory.get_strategy", return_value=mock_strategy)
    mocker.patch("app.domain.extraction.service.TextCleaner.clean", return_value="Cleaned Text")
    mock_record = mocker.patch("app.domain.extraction.service.record_extraction")

    mock_file = MagicMock()
    mock_file.filename = "test.txt"
    mock_file.content_type = "text/plain"
    mock_file.file.read.return_value = b"Dummy Content"

    result = ExtractionService.process_file(mock_file)

    assert result == "Cleaned Text"
    mock_strategy.extract.assert_called_once()
    mock_record.assert_called_once_with(
        mime_type="text/plain",
        file_size_bytes=len(b"Dummy Content"),
        text_bytes=len("Cleaned Text".encode("utf-8")),
    )

    called_path = mock_strategy.extract.call_args[0][0]
    assert called_path.endswith(".txt")
    assert not os.path.exists(called_path)


def test_process_file_too_large(mocker):
    from app.core.config import settings
    from app.core.exceptions import FileTooLargeError

    mock_file = MagicMock()
    mock_file.filename = "large.txt"
    mock_file.content_type = "text/plain"
    oversized = b"x" * (settings.MAX_UPLOAD_SIZE_BYTES + 1)
    mock_file.file.read.return_value = oversized

    with pytest.raises(FileTooLargeError) as exc_info:
        ExtractionService.process_file(mock_file)

    assert "exceeds limit" in str(exc_info.value)


def test_process_file_cleanup_on_error(mocker):
    mock_strategy = MagicMock()
    mock_strategy.extract.side_effect = Exception("Parsing Failed")
    mocker.patch("app.domain.extraction.service.ExtractorFactory.get_strategy", return_value=mock_strategy)
    mock_record_failure = mocker.patch("app.domain.extraction.service.record_extraction_failure")

    mock_file = MagicMock()
    mock_file.filename = "test.pdf"
    mock_file.content_type = "application/pdf"
    mock_file.file.read.return_value = b"Dummy PDF Content"

    with pytest.raises(Exception) as exc_info:
        ExtractionService.process_file(mock_file)

    assert str(exc_info.value) == "Parsing Failed"
    mock_record_failure.assert_called_once_with(
        mime_type="application/pdf",
        file_size_bytes=len(b"Dummy PDF Content"),
    )

    called_path = mock_strategy.extract.call_args[0][0]
    assert not os.path.exists(called_path)
