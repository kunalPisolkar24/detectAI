from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExtractCommand:
    filename: str
    mime_type: str
    content: bytes
