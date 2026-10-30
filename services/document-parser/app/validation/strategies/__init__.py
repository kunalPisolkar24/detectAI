"""The concrete admission strategies and their shared contract."""

from .base import DocumentValidationStrategy
from .docx import DocxValidationStrategy
from .pdf import PdfValidationStrategy
from .text import TextValidationStrategy

__all__ = [
    "DocumentValidationStrategy",
    "DocxValidationStrategy",
    "PdfValidationStrategy",
    "TextValidationStrategy",
]
