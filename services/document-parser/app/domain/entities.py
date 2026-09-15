from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExtractionResult:
    text: str
    truncated: bool = False
