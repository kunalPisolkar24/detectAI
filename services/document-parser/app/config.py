import logging

from pydantic import Field, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    # requirements.md: the key is mandatory in every environment and must be
    # at least 16 characters; an invalid value fails the boot. The empty
    # default keeps missing and invalid keys on the same min_length failure
    # path instead of a "field required" constructor error.
    api_key: str = Field(default="", min_length=16)

    # Field names map to env names case-insensitively (API_KEY,
    # MAX_PDF_PAGES, ...).

    max_upload_size_bytes: int = Field(default=10_485_760)
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
