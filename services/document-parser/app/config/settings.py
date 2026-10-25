"""The typed contract, resolved once per boot from a config plane.

Settings declares exactly the fields the runtime consumes — the api key,
the upload bound, and whatever their tasks land next (the planes keep
carrying the seeded keys either way, and from_provider ignores whatever
the model does not declare). Config selection lives in the factories: the
deployment flick picks the plane, the plane feeds the model.
"""

import os
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from ..validation.models import (
    DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES,
    DEFAULT_MAX_PDF_PAGES,
    DEFAULT_UPLOAD_LIMIT_BYTES,
)
from .provider import ConfigProvider


def deployment_flick() -> Literal["dev", "prod"]:
    """The plane selector: prod only when ENV_TYPE is exactly prod
    (trimmed, casefolded); anything else is dev — fail closed. It is a
    deployment variable read from the process environment, never from a
    file or AWS."""
    return "prod" if os.environ.get("ENV_TYPE", "").strip().lower() == "prod" else "dev"


def _positive_int_or_default(value: object, default: int) -> int:
    """The bounds' fail-closed read (requirements.md): int-like values pass
    through when positive; anything unreadable or non-positive lands on
    the safe default."""
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value if value > 0 else default
    if isinstance(value, str):
        try:
            parsed = int(value.strip())
        except ValueError:
            return default
        return parsed if parsed > 0 else default
    return default


class Settings(BaseModel):
    model_config = ConfigDict(validate_default=True)

    # requirements.md: the credential is mandatory in every environment and
    # must be at least 16 characters; an invalid value fails the boot. The
    # empty default plus default validation keeps missing and invalid keys
    # on the same min_length failure path instead of a "field required"
    # constructor error.
    api_key: str = Field(default="", min_length=16)

    # requirements.md numeric bounds fail closed: an unset, non-numeric, or
    # non-positive bound lands on its safe default instead of stopping the
    # boot — only the credential may do that. Bounds ride the plane as
    # strings (string parameters only), so the before-validator is their
    # sole guard. The defaults are single-sourced in the validation
    # package, which also enforces them.
    upload_limit_bytes: int = DEFAULT_UPLOAD_LIMIT_BYTES
    max_pdf_pages: int = DEFAULT_MAX_PDF_PAGES
    docx_max_uncompressed_bytes: int = DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES

    @field_validator(
        "upload_limit_bytes", "max_pdf_pages", "docx_max_uncompressed_bytes", mode="before"
    )
    @classmethod
    def _fail_closed_bound(cls, value: object, info: ValidationInfo) -> int:
        return _positive_int_or_default(value, default=cls.model_fields[info.field_name].default)

    @classmethod
    def from_provider(cls, provider: ConfigProvider) -> "Settings":
        """Build from a plane: one upper-snake lookup per declared field.

        The planes speak env names (upper snake), the model speaks field
        names. A seeded key without a matching field is ignored here —
        the consume-first rule — and a missing or invalid required key fails
        the boot on the field's own contract.
        """
        values: dict[str, str] = {}
        for name in cls.model_fields:
            value = provider.get(name.upper())
            if value is not None:
                values[name] = value
        return cls(**values)
