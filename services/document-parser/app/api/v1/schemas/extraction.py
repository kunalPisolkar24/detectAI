from pydantic import BaseModel

from app.domain.entities import ExtractionResult


class ExtractionResponse(BaseModel):
    filename: str
    content_type: str
    text_length: int
    text: str
    truncated: bool = False

    @classmethod
    def from_domain(cls, filename: str, content_type: str, result: ExtractionResult) -> "ExtractionResponse":
        return cls(
            filename=filename,
            content_type=content_type,
            text_length=len(result.text),
            text=result.text,
            truncated=result.truncated,
        )


class HealthCheck(BaseModel):
    status: str
