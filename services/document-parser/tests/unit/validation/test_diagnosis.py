"""The unknown-content diagnosis: accurate-enough names for rejected bytes.

The table runs only after the registry declines, so nothing here can
shadow an admitted type — a full decline means undecodable, non-PDF,
non-zip bytes at the default registry.
"""

import pytest

from app.validation.diagnosis import classify_unknown


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (b"\x89PNG\r\n\x1a\n\r\n pixel body", "image/png"),
        (b"\xff\xd8\xff\xe0 junk", "image/jpeg"),
        (b"GIF89a", "image/gif"),
        (b"\xd0\xcf\x11\xe0 the legacy .doc trap", "application/msword"),
        (b"PK\x05\x06 a zip with no local files", "application/zip"),
        (b"\x1f\x8b gzip bytes", "application/gzip"),
        (b"Rar!\x1a\x07\x01\x00", "application/vnd.rar"),
        (b"7z\xbc\xaf\x27\x1c", "application/x-7z-compressed"),
        (b"MZ\x90\x00 dos bytes", "application/x-msdownload"),
        (b"\x7fELF\x02\x01\x01", "application/x-elf"),
        (b"\x00\x01\x02\x03 no clue", "application/octet-stream"),
        (b"", "application/octet-stream"),
    ],
)
def test_classify_unknown_names_the_magic_and_falls_back(body: bytes, expected: str) -> None:
    assert classify_unknown(body) == expected
