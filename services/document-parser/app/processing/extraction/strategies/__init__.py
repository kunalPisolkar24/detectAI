"""One strategy per sniffed MIME; base.py holds the seam."""

from .base import DocumentExtractionStrategy
from .docx import DocxExtractionStrategy
from .pdf import PdfExtractionStrategy
from .text import TextExtractionStrategy

__all__ = [
    "DocumentExtractionStrategy",
    "DocxExtractionStrategy",
    "PdfExtractionStrategy",
    "TextExtractionStrategy",
]
