import re

from src.domain.exceptions import InvalidInputError

# Unicode Cc (control) is exactly U+0000-U+001F and U+007F-U+009F. A compiled
# regex keeps this scan in C instead of a per-char unicodedata.category()
# Python loop over up to MAX_TEXT_CHARS input.
_CONTROLS_RE = re.compile("[\x00-\x1f\x7f-\x9f]")


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
        sanitized = _CONTROLS_RE.sub(" ", text)
        sanitized = sanitized.strip()

        if not sanitized:
            raise InvalidInputError("Text cannot be only control characters")

        if len(sanitized) > self.max_text_chars:
            raise InvalidInputError(f"Text exceeds maximum length of {self.max_text_chars} characters")

        return sanitized
