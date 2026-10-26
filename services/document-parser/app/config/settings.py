"""The typed contract, resolved once per boot from a config plane.

Settings declares exactly the fields the runtime consumes — the api key,
the upload bound, and whatever their tasks land next (the planes keep
carrying the seeded keys either way, and from_provider ignores whatever
the model does not declare). Config selection lives in the factories: the
deployment flick picks the plane, the plane feeds the model.
"""

import math
import os
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationInfo,
    field_validator,
    model_validator,
)

from ..extraction.models import (
    DEFAULT_EDGE_TOLERANCE_RATIO,
    DEFAULT_EDGE_ZONE_RATIO,
    DEFAULT_FOLIO_MONOTONIC_RATIO,
    DEFAULT_HEADER_EDGE_ZONE_RATIO,
    DEFAULT_HEADER_REPETITION_RATIO,
    DEFAULT_OUTPUT_CHAR_LIMIT,
    DEFAULT_PROCESSING_BUDGET_SECONDS,
    DEFAULT_REPETITION_MIN_PAGES,
)
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


def _positive_float_or_default(value: object, default: float) -> float:
    """The budget's fail-closed read (extraction.md): float-like values pass
    through when positive — an int seed rides too (10 means 10.0) — anything
    unreadable, non-positive, or non-finite lands on the safe default."""
    if isinstance(value, bool):
        return default
    if isinstance(value, str):
        try:
            parsed = float(value.strip())
        except ValueError:
            return default
    elif isinstance(value, (int, float)):
        parsed = float(value)
    else:
        return default
    return parsed if math.isfinite(parsed) and parsed > 0 else default


class Settings(BaseModel):
    model_config = ConfigDict(validate_default=True)

    # requirements.md: the credential is mandatory in every environment and
    # must be at least 16 characters; an invalid value fails the boot. The
    # empty default plus default validation keeps missing and invalid keys
    # on the same min_length failure path instead of a "field required"
    # constructor error.
    api_key: str = Field(default="", min_length=16)

    # requirements.md numeric bounds and extraction.md's consumption knobs
    # fail closed the same way: an unset, non-numeric, or non-positive value
    # lands on its safe default instead of stopping the boot — only the
    # credential may do that. Values ride the plane as strings (string
    # parameters only), so the before-validators are their sole guard. The
    # defaults are single-sourced in the validation and extraction packages,
    # which also enforce (or spend) them at runtime.
    upload_limit_bytes: int = DEFAULT_UPLOAD_LIMIT_BYTES
    max_pdf_pages: int = DEFAULT_MAX_PDF_PAGES
    docx_max_uncompressed_bytes: int = DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES
    processing_budget_seconds: float = DEFAULT_PROCESSING_BUDGET_SECONDS
    output_char_limit: int = DEFAULT_OUTPUT_CHAR_LIMIT

    # cleaning.md's phase-1 knobs are deliberately harsher than the bounds
    # above: an out-of-range or non-numeric value fails the boot — a
    # deletion rule is never silently loosened by a fallback default. The
    # planes carry strings, pydantic coerces them natively, and the range
    # checks below raise; the defaults are single-sourced in the
    # extraction package, which also reads them back through CleaningKnobs.
    header_repetition_ratio: float = DEFAULT_HEADER_REPETITION_RATIO
    repetition_min_pages: int = DEFAULT_REPETITION_MIN_PAGES
    header_edge_zone_ratio: float = DEFAULT_HEADER_EDGE_ZONE_RATIO
    edge_zone_ratio: float = DEFAULT_EDGE_ZONE_RATIO
    edge_tolerance_ratio: float = DEFAULT_EDGE_TOLERANCE_RATIO
    folio_monotonic_ratio: float = DEFAULT_FOLIO_MONOTONIC_RATIO

    # observability.md's NFR-5 gate and resource identity. The endpoint is the
    # gate itself: its presence flips the observability factory to the wired
    # build, and its absence is a legitimate disabled boot in every plane,
    # which is exactly why these fields ride the plain contract — an unset
    # plane must never trip a credential-style min_length here. The license
    # key is the ingest key carried in the secrets blob (not SSM); the ratio
    # fails the boot off its unit interval like the cleaning ratios do.
    # Enforcement lands with the wired build — TODO(observability build).
    otel_exporter_otlp_endpoint: str | None = None
    new_relic_license_key: str | None = None
    otel_service_name: str = "document-parser"
    otel_service_version: str | None = None
    otel_trace_sample_ratio: float = 1.0

    @field_validator(
        "upload_limit_bytes",
        "max_pdf_pages",
        "docx_max_uncompressed_bytes",
        "output_char_limit",
        mode="before",
    )
    @classmethod
    def _fail_closed_bound(cls, value: object, info: ValidationInfo) -> int:
        # The name is always present for a field validator; None only means
        # the validator was bound to nothing, which is a wiring bug.
        field_name = info.field_name
        if field_name is None:
            raise ValueError("the fail-closed bound validator requires a field name")
        return _positive_int_or_default(value, default=cls.model_fields[field_name].default)

    @field_validator("processing_budget_seconds", mode="before")
    @classmethod
    def _fail_closed_budget(cls, value: object, info: ValidationInfo) -> float:
        field_name = info.field_name
        if field_name is None:
            raise ValueError("the fail-closed budget validator requires a field name")
        return _positive_float_or_default(value, default=cls.model_fields[field_name].default)

    @field_validator(
        "header_repetition_ratio", "edge_tolerance_ratio", "folio_monotonic_ratio"
    )
    @classmethod
    def _ratio_inside_the_unit_interval(cls, value: float) -> float:
        if not 0.0 < value < 1.0:
            raise ValueError("the ratio must be strictly between 0 and 1 (cleaning.md)")
        return value

    @field_validator("header_edge_zone_ratio", "edge_zone_ratio")
    @classmethod
    def _zone_stays_off_half_the_page(cls, value: float) -> float:
        if not 0.0 < value < 0.5:
            raise ValueError("the edge zone must be strictly between 0 and 1/2 (cleaning.md)")
        return value

    @field_validator("repetition_min_pages")
    @classmethod
    def _repetition_needs_a_few_pages(cls, value: int) -> int:
        if value < 2:
            raise ValueError("the repetition floor must be at least 2 pages (cleaning.md)")
        return value

    @model_validator(mode="after")
    def _gate_without_a_key_does_not_trip_yet(self) -> "Settings":
        """TODO(observability build): THE gate — an endpoint without a
        license key fails the boot on the same path as API_KEY's minimum
        length, while an unset (or blank) endpoint stays a legitimate
        disabled boot in every plane. Deferred with the wired build so the
        skeleton cannot fail a boot the wired build could not have served
        anyway; until then these two fields ride inert."""
        return self

    @field_validator("otel_trace_sample_ratio")
    @classmethod
    def _sample_stays_inside_the_unit_interval_deferred(cls, value: float) -> float:
        """TODO(observability build): 0 < ratio ≤ 1, failing the boot like the
        cleaning ratios do. Deferred with the wired build — the enforcement
        lands beside the sampler that consumes it (and its tests)."""
        return value

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
        # model_validate, not __init__: the plane carries the field names as
        # a typed dict of strings and the field contracts own the coercion,
        # so the values enter through the validation path (the bounds ride
        # in as strings and the before-validator is their sole guard).
        return cls.model_validate(values)
