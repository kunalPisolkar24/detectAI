"""Best-effort MIME naming for unrecognized uploads; diagnostic only, never admission.

Two-character signatures are safe: decodable bytes never reach a registry
decline — the text strategy claims them first.
"""

_UNKNOWN_MIME = "application/octet-stream"

_MAGICS: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"BM", "image/bmp"),
    (b"\xd0\xcf\x11\xe0", "application/msword"),
    (b"PK\x05\x06", "application/zip"),
    (b"PK\x07\x08", "application/zip"),
    (b"\x1f\x8b", "application/gzip"),
    (b"7z\xbc\xaf\x27\x1c", "application/x-7z-compressed"),
    (b"Rar!\x1a\x07", "application/vnd.rar"),
    (b"\x00\x00\x01\x00", "image/x-icon"),
    (b"II*\x00", "image/tiff"),
    (b"MM\x00*", "image/tiff"),
    (b"\x7fELF", "application/x-elf"),
    (b"MZ", "application/x-msdownload"),
)


def classify_unknown(data: bytes) -> str:
    """Name what the bytes probably are; the error body is the only consumer."""
    for signature, mime in _MAGICS:
        if data.startswith(signature):
            return mime
    return _UNKNOWN_MIME
