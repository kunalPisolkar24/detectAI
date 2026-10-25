"""Best-effort naming for uploads nobody recognized.

Runs only after the whole registry declines: the 415 detail must name the
MIME (http.md), so this module is narrowly diagnostic — a content-type
guess for the error body, never admission. Unmatched bytes fall back to
application/octet-stream.
"""


def classify_unknown(data: bytes) -> str:
    """TODO: magic-table lookup over common unsupported formats, else application/octet-stream."""
    raise NotImplementedError
