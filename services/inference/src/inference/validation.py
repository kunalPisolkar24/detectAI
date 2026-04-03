from src.core.exceptions import InvalidInputError


class InputValidator:
    def __init__(self, max_text_chars: int):
        self.max_text_chars = max_text_chars

    def validate(self, text: str) -> str:
        if not text or not text.strip():
            raise InvalidInputError("Text cannot be empty")

        if len(text) > self.max_text_chars:
            raise InvalidInputError(f"Text exceeds maximum length of {self.max_text_chars} characters")

        return text
