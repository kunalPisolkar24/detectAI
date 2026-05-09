import pytest
import os
from unittest.mock import MagicMock, patch
from fastapi import UploadFile
from app.domain.extraction.service import ExtractionService

def test_process_file_success(mocker):
    # Mock the strategy to avoid actual parsing
    mock_strategy = MagicMock()
    mock_strategy.extract.return_value = "Mocked Raw Text"
    mocker.patch("app.domain.extraction.service.ExtractorFactory.get_strategy", return_value=mock_strategy)

    # Mock the cleaner
    mocker.patch("app.domain.extraction.service.TextCleaner.clean", return_value="Cleaned Text")

    # Create a mock UploadFile
    mock_file = MagicMock()
    mock_file.filename = "test.txt"
    mock_file.content_type = "text/plain"
    mock_file.file.read.return_value = b"Dummy Content"

    # Execute
    result = ExtractionService.process_file(mock_file)

    # Verify
    assert result == "Cleaned Text"
    mock_strategy.extract.assert_called_once()
    
    # Ensure temporary file path passed to extract ends with correct suffix
    called_path = mock_strategy.extract.call_args[0][0]
    assert called_path.endswith(".txt")
    
    # Verify temp file is cleaned up
    assert not os.path.exists(called_path)

def test_process_file_cleanup_on_error(mocker):
    # Mock strategy to raise an error
    mock_strategy = MagicMock()
    mock_strategy.extract.side_effect = Exception("Parsing Failed")
    mocker.patch("app.domain.extraction.service.ExtractorFactory.get_strategy", return_value=mock_strategy)

    mock_file = MagicMock()
    mock_file.filename = "test.pdf"
    mock_file.content_type = "application/pdf"
    mock_file.file.read.return_value = b"Dummy PDF Content"

    with pytest.raises(Exception) as exc_info:
        ExtractionService.process_file(mock_file)

    assert str(exc_info.value) == "Parsing Failed"
    
    # Check that temp file cleanup still happened
    called_path = mock_strategy.extract.call_args[0][0]
    assert not os.path.exists(called_path)
