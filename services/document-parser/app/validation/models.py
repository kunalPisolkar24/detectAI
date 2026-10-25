"""The admission vocabulary shared by every layer.

ValidationOutcome and UnsupportedTypeError are the types the strategies
return, the service routes, and the extract endpoint maps onto HTTP. They
live in a leaf module so the dependency direction stays one-way:
strategies, the service, and api/ all import models, nothing imports back.
"""

from dataclasses import dataclass


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
