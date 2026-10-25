import logging
import math
import os
from typing import Any, Literal

from pydantic import Field, ValidationInfo, field_validator
from pydantic.fields import FieldInfo
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

logger = logging.getLogger(__name__)


def deployment_flick() -> Literal["dev", "prod"]:
    """The single plane flick: prod only when ENV_TYPE is exactly prod
    (trimmed, casefolded); anything else is dev — the same fail-closed rule
    the env_type validator applies. It is a deployment variable read from the
    process environment, never from a file or AWS."""
    return "prod" if os.environ.get("ENV_TYPE", "").strip().lower() == "prod" else "dev"


class DeploymentFlagSource(PydanticBaseSettingsSource):
    """Injects the flick itself: ENV_TYPE is deliberately unseeded, so the
    prod chain resolves its one field value from the bootstrap variable."""

    # Wholesale dict source (as AwsConfigSource): the per-field hook never fires.
    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        raise AssertionError("DeploymentFlagSource provides values as one wholesale dict")

    def __call__(self) -> dict[str, Any]:
        return {"env_type": deployment_flick()}


class Settings(BaseSettings):
    # requirements.md: the key is mandatory in every environment and must be
    # at least 16 characters; an invalid value fails the boot. The empty
    # default keeps missing and invalid keys on the same min_length failure
    # path instead of a "field required" constructor error.
    api_key: str = Field(default="", min_length=16)

    # Deployment mode (repo-wide ENV_TYPE convention, apps/web): unset boots
    # as dev; an invalid value falls back to dev like the numeric bounds.
    env_type: Literal["dev", "prod"] = Field(default="dev")

    # Field names map to env names case-insensitively (API_KEY,
    # MAX_PDF_PAGES, ...).

    max_upload_size_bytes: int = Field(default=10_485_760)
    process_budget_seconds: float = Field(default=10.0)
    max_pdf_pages: int = Field(default=1_000)
    max_docx_uncompressed_bytes: int = Field(default=104_857_600)
    max_text_length: int = Field(default=1_000_000)

    otel_exporter_otlp_endpoint: str | None = Field(default=None)
    otel_service_name: str = Field(default="document-parser")

    model_config = SettingsConfigDict(env_file="infra/.env", extra="ignore")

    # requirements.md numeric bounds fail closed: an unset or invalid value
    # falls back to the safe default instead of failing the boot.
    @field_validator(
        "max_upload_size_bytes",
        "max_pdf_pages",
        "max_docx_uncompressed_bytes",
        "max_text_length",
        mode="before",
    )
    @classmethod
    def _fall_back_to_safe_default(cls, value: object, info: ValidationInfo) -> int:
        # Field validators always run on a field, but the type stays Optional.
        field_name = info.field_name
        assert field_name is not None
        default = cls.model_fields[field_name].default
        try:
            parsed = int(str(value))
        except ValueError:
            logger.warning(
                "%s is not a valid integer (%r); using the safe default %s",
                field_name.upper(),
                value,
                default,
            )
            return default
        if parsed <= 0:
            logger.warning(
                "%s must be positive (got %s); using the safe default %s",
                field_name.upper(),
                parsed,
                default,
            )
            return default
        return parsed

    # NFR-3 budget: float parsing keeps tuned sub-second rigs honest ("2.5" would
    # otherwise fail int parsing and silently drop back to 10 s), and a finite
    # check rejects "1e400"/"inf" (inf would disable the budget entirely).
    @field_validator("process_budget_seconds", mode="before")
    @classmethod
    def _fall_back_to_safe_budget(cls, value: object, info: ValidationInfo) -> float:
        field_name = info.field_name
        assert field_name is not None
        default = cls.model_fields[field_name].default
        try:
            parsed = float(str(value))
        except ValueError:
            logger.warning(
                "%s is not a valid number (%r); using the safe default %s",
                field_name.upper(),
                value,
                default,
            )
            return default
        if not math.isfinite(parsed):
            logger.warning(
                "%s must be finite (got %s); using the safe default %s",
                field_name.upper(),
                parsed,
                default,
            )
            return default
        if parsed <= 0:
            logger.warning(
                "%s must be positive (got %s); using the safe default %s",
                field_name.upper(),
                parsed,
                default,
            )
            return default
        return parsed

    @field_validator("env_type", mode="before")
    @classmethod
    def _fall_back_to_safe_env_type(cls, value: object, info: ValidationInfo) -> str:
        field_name = info.field_name
        assert field_name is not None
        if isinstance(value, str):
            raw = value.strip().lower()
            if raw in ("dev", "prod"):
                return raw
        logger.warning(
            "%s must be dev or prod (%r); using the safe default %s",
            field_name.upper(),
            value,
            "dev",
        )
        return "dev"

    # Plane selection (specification/references/config.md): ENV_TYPE decides
    # where values come from, once, at construction. dev keeps pydantic's
    # default chain (init, env, dotenv reading infra/.env) — today's behavior,
    # unchanged. prod composes the AWS reader exactly: process env and dotenv
    # are dropped, so a stray container variable can never take over an
    # unseeded key, and an unresolvable api_key fails the boot. Pydantic
    # appends its own default source after the returned tuple, so unset
    # numeric fields still fall back to their safe defaults.
    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        if deployment_flick() == "prod":
            # Lazy: prod boots pay the boto3 import once; dev boots never do.
            from ..config_source import AwsConfigSource

            return (
                init_settings,
                AwsConfigSource.from_env(settings_cls),
                DeploymentFlagSource(settings_cls),
            )
        return (init_settings, env_settings, dotenv_settings, file_secret_settings)
