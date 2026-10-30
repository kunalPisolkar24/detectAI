"""The typed boot contract, resolved once from a config plane."""

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

# Mirrors tools/secrets.py's gate: boot and seeding demand the same pair or none.
NEW_RELIC_LICENSE_KEY_MIN_LENGTH = 16


def deployment_flick() -> Literal["dev", "prod"]:
    """Fail closed: only an exact prod in ENV_TYPE is prod; never read from a file or AWS."""
    return "prod" if os.environ.get("ENV_TYPE", "").strip().lower() == "prod" else "dev"


def _positive_int_or_default(value: object, default: int) -> int:
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

    # Empty default + default validation: missing and bad keys share one
    # min_length failure path (requirements.md) instead of "field required".
    api_key: str = Field(default="", min_length=16)

    # Bounds fail closed: unreadable or non-positive -> safe default. Only
    # the credential may stop the boot; before-validators own the coercion.
    upload_limit_bytes: int = DEFAULT_UPLOAD_LIMIT_BYTES
    max_pdf_pages: int = DEFAULT_MAX_PDF_PAGES
    docx_max_uncompressed_bytes: int = DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES
    processing_budget_seconds: float = DEFAULT_PROCESSING_BUDGET_SECONDS
    output_char_limit: int = DEFAULT_OUTPUT_CHAR_LIMIT

    # cleaning.md knobs fail boot on range: a deletion rule is never silently loosened.
    header_repetition_ratio: float = DEFAULT_HEADER_REPETITION_RATIO
    repetition_min_pages: int = DEFAULT_REPETITION_MIN_PAGES
    header_edge_zone_ratio: float = DEFAULT_HEADER_EDGE_ZONE_RATIO
    edge_zone_ratio: float = DEFAULT_EDGE_ZONE_RATIO
    edge_tolerance_ratio: float = DEFAULT_EDGE_TOLERANCE_RATIO
    folio_monotonic_ratio: float = DEFAULT_FOLIO_MONOTONIC_RATIO

    # NFR-5: the endpoint is the gate — unset is a legitimate disabled boot, so
    # these fields must never trip a credential-style min_length in any plane.
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
    def _gate_observability(self) -> "Settings":
        """A blank endpoint is an unset one: normalized here, so this field alone is the gate."""
        endpoint = (self.otel_exporter_otlp_endpoint or "").strip()
        if not endpoint:
            self.otel_exporter_otlp_endpoint = None
            return self
        self.otel_exporter_otlp_endpoint = endpoint
        key = self.new_relic_license_key
        if key is None or len(key) < NEW_RELIC_LICENSE_KEY_MIN_LENGTH:
            raise ValueError(
                "OTEL_EXPORTER_OTLP_ENDPOINT is set, so NEW_RELIC_LICENSE_KEY must "
                f"be at least {NEW_RELIC_LICENSE_KEY_MIN_LENGTH} characters "
                "(the ingest license key, tools/secrets.py's floor)"
            )
        return self

    @field_validator("otel_trace_sample_ratio")
    @classmethod
    def _sample_stays_inside_its_unit_interval(cls, value: float) -> float:
        if not 0.0 < value <= 1.0:
            raise ValueError(
                "otel_trace_sample_ratio must lie in the interval (0, 1] (observability.md)"
            )
        return value

    @classmethod
    def from_provider(cls, provider: ConfigProvider) -> "Settings":
        """Consume-first: a seeded key without a matching field is ignored."""
        values: dict[str, str] = {}
        for name in cls.model_fields:
            value = provider.get(name.upper())
            if value is not None:
                values[name] = value
        # model_validate, not __init__: string-typed plane values must enter
        # through validation, where the before-validators own the coercion.
        return cls.model_validate(values)
