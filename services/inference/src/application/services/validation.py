import unicodedata
from src.domain.exceptions import InvalidInputError


class InputValidator:
    def __init__(self, max_text_chars: int):
        if not isinstance(max_text_chars, int) or max_text_chars <= 0:
            raise ValueError("max_text_chars must be an int >0")
        self.max_text_chars = max_text_chars

    def validate(self, text: str) -> str:
        if not isinstance(text, str):
            raise InvalidInputError("Text must be a string")
        if not text or not text.strip():
            raise InvalidInputError("Text cannot be empty")

        # Replace control characters (Cc) with space to preserve word boundaries; keep other categories
        # Previously deleted all C* which concatenated words like "hello\\nworld" -> "helloworld"
        sanitized = "".join(" " if unicodedata.category(ch) == "Cc" else ch for ch in text)
        sanitized = sanitized.strip()

        if not sanitized:
            raise InvalidInputError("Text cannot be only control characters")

        if len(sanitized) > self.max_text_chars:
            raise InvalidInputError(f"Text exceeds maximum length of {self.max_text_chars} characters")

        return sanitized
