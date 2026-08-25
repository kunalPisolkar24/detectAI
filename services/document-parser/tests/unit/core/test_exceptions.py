import pytest

from app.core.exceptions import (
    DocumentParserError,
    DocumentTooLargeError,
    ExtractionError,
    ExtractionTimeoutError,
    FileTooLargeError,
    UnsupportedFileTypeError,
)


def test_base_error_defaults_to_500():
    error = DocumentParserError("boom")
    assert error.status_code == 500
    assert error.message == "boom"


def test_base_error_accepts_custom_status():
    assert DocumentParserError("gone", status_code=404).status_code == 404


def test_extraction_error_wraps_detail_with_prefix():
    error = ExtractionError("bad xref")
    assert error.status_code == 422
    assert error.message == "Extraction failed: bad xref"


def test_file_too_large_reports_sizes():
    error = FileTooLargeError(20 * 1024 * 1024, 10 * 1024 * 1024)
    assert error.status_code == 413
    assert "20971520" in error.message
    assert "10.0MB" in error.message


def test_document_too_large_reports_content_size():
    error = DocumentTooLargeError(200 * 1024 * 1024, 100 * 1024 * 1024)
    assert error.status_code == 413
    assert "Document content size" in error.message
    assert "100.0MB" in error.message


def test_unsupported_type_names_the_mime():
    error = UnsupportedFileTypeError("image/gif")
    assert error.status_code == 415
    assert "image/gif" in error.message


def test_timeout_error_includes_seconds_and_504():
    error = ExtractionTimeoutError(30.0)
    assert error.status_code == 504
    assert "30.0" in error.message


@pytest.mark.parametrize(
    "error_factory,expected_status",
    [
        (lambda: ExtractionError("x"), 422),
        (lambda: FileTooLargeError(2, 1), 413),
        (lambda: DocumentTooLargeError(2, 1), 413),
        (lambda: UnsupportedFileTypeError("t/b"), 415),
        (lambda: ExtractionTimeoutError(1), 504),
    ],
)
def test_all_subclasses_are_document_parser_errors(error_factory, expected_status):
    error = error_factory()
    assert isinstance(error, DocumentParserError)
    assert error.status_code == expected_status
