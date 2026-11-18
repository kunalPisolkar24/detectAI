from src.application.services.chunking import ChunkPlanner
from src.application.services.validation import InputValidator
from src.domain.exceptions import InvalidInputError
from src.domain.models import DocumentChunk


class TextPreparationPipeline:
    def __init__(self, validator: InputValidator, planners: dict[str, ChunkPlanner]) -> None:
        if validator is None:
            raise ValueError("validator is required")
        if not planners:
            raise ValueError("planners must be non-empty")
        self.validator = validator
        self.planners = planners

    def prepare(self, text: str, model_key: str) -> tuple[str, list[DocumentChunk]]:
        if model_key not in self.planners:
            raise InvalidInputError(f"Unknown model key: {model_key}")
        validated = self.validator.validate(text)
        chunks = self.planners[model_key].plan(validated)
        if not chunks:
            raise InvalidInputError("No chunks were generated for the provided text")
        return validated, chunks
