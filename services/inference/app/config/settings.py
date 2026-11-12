"""The typed boot contract, resolved once from a config plane."""

import os
import re
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from .provider import ConfigProvider

# Mirrors the tfctl declaration's floor: boot and seeding demand the same pair or none.
NEW_RELIC_LICENSE_KEY_MIN_LENGTH = 16

# The pull defaults: public repos, pinned to the reviewed artifact builds.
FLARE_MODEL_REPO = "kpisolkar24/detect-ai-flare"
FLARE_MODEL_REVISION = "27f289bbd45063a28be75450863c784574fad76f"
FLARE_MODEL_DIR = "onnx/fp32"
SPARK_MODEL_REPO = "kpisolkar24/detect-ai-spark"
SPARK_MODEL_REVISION = "b0ab87257cc240d66622c2482270ec726e16c553"
SPARK_MODEL_DIR = "onnx/fp16"

_GIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")

_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})

# Pure strings so Settings never imports onnxruntime; the loader consumes the names.
_EXECUTION_PROVIDERS = frozenset({
    "CPUExecutionProvider",
    "CUDAExecutionProvider",
    "TensorrtExecutionProvider",
    "ROCMExecutionProvider",
})


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


class Settings(BaseModel):
    model_config = ConfigDict(validate_default=True)

    # Empty default + default validation: missing and bad keys share one
    # min_length failure path instead of "field required".
    api_key: str = Field(default="", min_length=16)

    # A public-repo pull needs no token; a blank seed is an unset one.
    hf_token: str | None = None

    # The gRPC server knob fails closed: unreadable or non-positive -> 50051.
    grpc_port: int = 50051
    log_level: str = "INFO"

    # Where pulled artifacts land; a volume mount in a container keeps restarts cheap.
    model_cache_dir: str = "./models"

    # The pull contract per model: repo, the pinned artifact revision, and the
    # in-repo directory that holds the build (fp32 for flare, fp16 for spark).
    flare_model_repo: str = FLARE_MODEL_REPO
    flare_model_revision: str = FLARE_MODEL_REVISION
    flare_model_dir: str = FLARE_MODEL_DIR
    spark_model_repo: str = SPARK_MODEL_REPO
    spark_model_revision: str = SPARK_MODEL_REVISION
    spark_model_dir: str = SPARK_MODEL_DIR

    # The load contract: requested execution providers (order is preference)
    # and the per-session intra-op budget; 0 leaves ONNX Runtime's default.
    inference_providers: tuple[str, ...] = ("CPUExecutionProvider",)
    ort_intra_op_threads: int = 0

    # The endpoint is the gate — unset is a legitimate disabled boot, so these
    # fields must never trip a credential-style min_length in any plane.
    otel_exporter_otlp_endpoint: str | None = None
    new_relic_license_key: str | None = None
    otel_service_name: str = "inference"
    otel_service_version: str | None = None
    otel_trace_sample_ratio: float = 1.0

    @field_validator("grpc_port", mode="before")
    @classmethod
    def _fail_closed_port(cls, value: object) -> int:
        return _positive_int_or_default(value, default=cls.model_fields["grpc_port"].default)

    @field_validator("log_level", mode="before")
    @classmethod
    def _fail_closed_log_level(cls, value: object) -> str:
        normalized = value.strip().upper() if isinstance(value, str) else None
        return normalized if normalized in _LOG_LEVELS else cls.model_fields["log_level"].default

    @field_validator("hf_token", mode="before")
    @classmethod
    def _a_blank_token_is_an_unset_one(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

    @field_validator("flare_model_revision", "spark_model_revision")
    @classmethod
    def _revisions_are_full_pinned_shas(cls, value: str) -> str:
        if not _GIT_SHA_PATTERN.fullmatch(value):
            raise ValueError("model revisions must be full 40-character lowercase git SHAs")
        return value

    @field_validator("inference_providers", mode="before")
    @classmethod
    def _fail_closed_providers(cls, value: object) -> tuple[str, ...]:
        if isinstance(value, str):
            items: list[object] = value.split(",")
        elif isinstance(value, (list, tuple)):
            items = list(value)
        else:
            raise TypeError("inference_providers must be a CSV string or a sequence of names")
        names: list[str] = []
        for item in items:
            if not isinstance(item, str):
                raise TypeError("every inference provider must be a name string")
            name = item.strip()
            if name and name not in names:
                names.append(name)
        if not names:
            raise ValueError("at least one inference provider is required")
        unknown = [name for name in names if name not in _EXECUTION_PROVIDERS]
        if unknown:
            raise ValueError(
                f"unknown inference provider(s): {', '.join(unknown)}; "
                f"known: {', '.join(sorted(_EXECUTION_PROVIDERS))}"
            )
        return tuple(names)

    @field_validator("ort_intra_op_threads", mode="before")
    @classmethod
    def _fail_closed_threads(cls, value: object) -> int:
        return _positive_int_or_default(value, default=0)

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
                "(the ingest license key, the tfctl declaration's floor)"
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
