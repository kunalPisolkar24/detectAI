"""The admission vocabulary shared by every layer.

ValidationOutcome and the typed rejections are the types the strategies
return, the service routes, and the extract endpoint maps onto HTTP.
models.py is a leaf on purpose: strategies, the service, the settings
contract, and api/ all import it, nothing imports back — the dependency
direction stays one-way (outer to inner, never the reverse).

The numeric bound defaults live here too, one source for the settings
fields that resolve them and the strategies that enforce them.
"""

from dataclasses import dataclass

# requirements.md numeric bounds: the safe defaults, consumed by both the
# settings contract and the strategies.
DEFAULT_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024
DEFAULT_MAX_PDF_PAGES = 1_000
DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class ValidationOutcome:
    """One strategy's verdict on a body of bytes.

    mime is the canonical, sniffed content type — the declared Content-Type
    and the filename never get a vote (http.md decision 4). A returned
    outcome means recognized and admitted; None means the bytes belong to
    another type, and hard rejections arrive as exceptions instead of
    fields.
    """

    mime: str


class UnsupportedTypeError(Exception):
    """No strategy claimed the body; the detail names the sniffed MIME."""
