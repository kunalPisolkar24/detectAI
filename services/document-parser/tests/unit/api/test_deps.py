import asyncio
import io

import pytest
from fastapi import UploadFile

from app.api.deps import validate_upload
from app.core.exceptions import FileTooLargeError, UnsupportedFileTypeError


def _upload(data: bytes, filename: str, size: int | None = None) -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=filename, size=size)


def _run(upload):
    return asyncio.run(validate_upload(upload))


def test_header_size_guard_rejects_before_sniffing(mocker):
    mock_magic = mocker.patch("app.api.deps.magic.from_buffer")
    upload = _upload(b"x" * 10, "big.pdf", size=11 * 1024 * 1024)

    with pytest.raises(FileTooLargeError) as exc_info:
        _run(upload)

    assert "exceeds limit" in str(exc_info.value)
    mock_magic.assert_not_called()


def test_allowed_mime_returns_detected_type(mocker):
    mocker.patch("app.api.deps.magic.from_buffer", return_value="text/plain")
    upload = _upload(b"plain text", "note.txt", size=10)

    assert _run(upload) == "text/plain"


def test_disallowed_mime_rejected(mocker):
    mocker.patch("app.api.deps.magic.from_buffer", return_value="image/gif")
    upload = _upload(b"GIF89a", "pic.gif", size=6)

    with pytest.raises(UnsupportedFileTypeError) as exc_info:
        _run(upload)

    assert "image/gif" in str(exc_info.value)


def test_missing_size_still_sniffs_and_validates(mocker):
    mock_magic = mocker.patch("app.api.deps.magic.from_buffer", return_value="application/pdf")
    upload = _upload(b"%PDF-1.4", "doc.pdf", size=None)

    assert _run(upload) == "application/pdf"
    mock_magic.assert_called_once()


def test_magic_sniffs_first_4kb_and_resets_file_position(mocker):
    mocker.patch("app.api.deps.magic.from_buffer", return_value="text/plain")
    payload = bytes(range(256)) * 64
    upload = _upload(payload, "a.txt", size=len(payload))

    assert _run(upload) == "text/plain"
    assert upload.file.tell() == 0
