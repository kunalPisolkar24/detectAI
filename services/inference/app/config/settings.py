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

# The submission bound default: the document-parser cap's scale (~1M chars).
MAX_TEXT_CHARS_DEFAULT = 1_000_000

# The chunk window default: the total sequence length per chunk, special
# tokens included; the model ceiling clamps it down.
CHUNK_TOKEN_LIMIT_DEFAULT = 512

# The chunk overlap default: tokens of preceding context carried in a
# chunk's model input; 0 is no overlap.
CHUNK_TOKEN_OVERLAP_DEFAULT = 0

# The batch width default: the widest call the engine accepts. The CPU-safe
# value until the GPU sweep measures the real one.
INFERENCE_BATCH_SIZE_DEFAULT = 8

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


def _non_negative_int_or_default(value: object, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value if value >= 0 else default
    if isinstance(value, str):
        try:
            parsed = int(value.strip())
        except ValueError:
            return default
        return parsed if parsed >= 0 else default
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

    # The submission bound is admission, not truncation: a truncated document
    # changes the analysis, so over-limit text is rejected instead.
    max_text_chars: int = MAX_TEXT_CHARS_DEFAULT

    # The chunk window: the total sequence length per chunk, special tokens
    # included; the model ceiling clamps it down.
    chunk_token_limit: int = CHUNK_TOKEN_LIMIT_DEFAULT

    # The chunk overlap: tokens shared with the previous chunk, so a chunk's
    # model input carries context its scored region does not. 0 = no overlap.
    chunk_token_overlap: int = CHUNK_TOKEN_OVERLAP_DEFAULT

    # The batch width: the widest call the engine accepts, per model. The global
    # knob is the fallback; a per-model override wins over it.
    inference_batch_size: int = INFERENCE_BATCH_SIZE_DEFAULT
    flare_batch_size: int | None = None
    spark_batch_size: int | None = None

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

    @field_validator("max_text_chars", mode="before")
    @classmethod
    def _fail_closed_text_limit(cls, value: object) -> int:
        return _positive_int_or_default(value, default=cls.model_fields["max_text_chars"].default)

    @field_validator("chunk_token_limit", mode="before")
    @classmethod
    def _fail_closed_chunk_limit(cls, value: object) -> int:
        return _positive_int_or_default(value, default=cls.model_fields["chunk_token_limit"].default)

    @field_validator("chunk_token_overlap", mode="before")
    @classmethod
    def _fail_closed_chunk_overlap(cls, value: object) -> int:
        return _non_negative_int_or_default(
            value, default=cls.model_fields["chunk_token_overlap"].default
        )

    @field_validator("inference_batch_size", mode="before")
    @classmethod
    def _fail_closed_batch_size(cls, value: object) -> int:
        return _positive_int_or_default(
            value, default=cls.model_fields["inference_batch_size"].default
        )

    @field_validator("flare_batch_size", "spark_batch_size", mode="before")
    @classmethod
    def _fail_closed_model_batch_size(cls, value: object) -> int | None:
        """An unusable override is no override: the global knob governs."""
        if value is None:
            return None
        return _positive_int_or_default(value, default=0) or None

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
    def _gate_chunk_overlap(self) -> "Settings":
        """An overlap no window could honour fails the boot, not a silent clamp to zero."""
        if self.chunk_token_overlap >= self.chunk_token_limit:
            raise ValueError(
                f"chunk_token_overlap={self.chunk_token_overlap} is not usable: the chunk "
                f"window is at most CHUNK_TOKEN_LIMIT={self.chunk_token_limit} tokens, so "
                "the overlap must be less than it"
            )
        return self

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

    def batch_size_for(self, model_key: str) -> int:
        """The widest call one model accepts: its own override, else the global knob."""
        overrides = {"flare": self.flare_batch_size, "spark": self.spark_batch_size}
        override = overrides.get(model_key)
        return override if override is not None else self.inference_batch_size
