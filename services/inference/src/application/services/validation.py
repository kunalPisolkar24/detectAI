import unicodedata
from src.domain.exceptions import InvalidInputError


class InputValidator:
    def __init__(self, max_text_chars: int):
        self.max_text_chars = max_text_chars

    def validate(self, text: str) -> str:
        if not text or not text.strip():
            raise InvalidInputError("Text cannot be empty")

        sanitized = "".join(ch for ch in text if not unicodedata.category(ch).startswith("C"))
        sanitized = sanitized.strip()

        if not sanitized:
            raise InvalidInputError("Text cannot be only control characters")

        if len(sanitized) > self.max_text_chars:
            raise InvalidInputError(f"Text exceeds maximum length of {self.max_text_chars} characters")

        return sanitized
