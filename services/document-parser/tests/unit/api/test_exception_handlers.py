import asyncio
import json
from unittest.mock import MagicMock

import pytest
from fastapi import Request

from app.api.exception_handlers import GENERIC_EXTRACTION_DETAIL, document_parser_exception_handler
from app.core.exceptions import (
    DocumentParserError,
    ExtractionError,
    FileTooLargeError,
    UnsupportedFileTypeError,
)


@pytest.fixture
def fake_request():
    request = MagicMock(spec=Request)
    request.url.path = "/extract"
    return request


def _invoke(request, exc):
    return asyncio.run(document_parser_exception_handler(request, exc))


def test_extraction_error_returns_generic_detail(fake_request, mocker):
    mock_logger = mocker.patch("app.api.exception_handlers.logger")
    exc = ExtractionError("PDF processing failed: Mupdf internals")

    response = _invoke(fake_request, exc)

    assert response.status_code == 422
    assert json.loads(response.body) == {"detail": GENERIC_EXTRACTION_DETAIL}
    mock_logger.error.assert_called_once()
    assert "Mupdf internals" in mock_logger.error.call_args.kwargs["extra"]["request_meta"]["detail"]


def test_file_too_large_passes_message_through_and_counts_rejection(fake_request, mocker):
    mock_record = mocker.patch("app.api.exception_handlers.record_rejected_upload")
    exc = FileTooLargeError(20 * 1024 * 1024, 10 * 1024 * 1024)

    response = _invoke(fake_request, exc)

    assert response.status_code == 413
    assert "exceeds limit" in json.loads(response.body)["detail"]
    mock_record.assert_called_once_with(exc)


def test_unsupported_type_passes_message_through(fake_request, mocker):
    mocker.patch("app.api.exception_handlers.record_rejected_upload")
    exc = UnsupportedFileTypeError("image/gif")

    response = _invoke(fake_request, exc)

    assert response.status_code == 415
    assert "Unsupported media type: image/gif" in json.loads(response.body)["detail"]


def test_custom_document_parser_error_passthrough(fake_request, mocker):
    mocker.patch("app.api.exception_handlers.record_rejected_upload")

    class CustomError(DocumentParserError):
        def __init__(self):
            super().__init__("custom problem", status_code=418)

    response = _invoke(fake_request, CustomError())

    assert response.status_code == 418
    assert json.loads(response.body) == {"detail": "custom problem"}
