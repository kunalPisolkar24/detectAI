import re

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b\u200c\u200d\u2060\ufeff]")
_HYPHEN_BREAK = re.compile(r"-\n(\w)")


class TextCleaner:
    @staticmethod
    def clean(text: str) -> str:
        if not text:
            return ""
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        text = _CONTROL_CHARS.sub("", text)
        text = text.replace("\xa0", " ")
        text = _HYPHEN_BREAK.sub(r"\1", text)
        text = re.sub(r"(?i)page\s+\d+\s+of\s+\d+\n?", "", text)
        text = re.sub(r"\n\s*-\s*\d+\s*-\s*\n", "\n", text)
        text = re.sub(r"[ \t]+", " ", text)
        lines = [line.strip() for line in text.split("\n")]
        text = "\n".join(lines)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()
