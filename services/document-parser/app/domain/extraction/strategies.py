import fitz  # noqa: F401
import docx  # noqa: F401
import zipfile  # noqa: F401

from app.application.ports.extractor import ExtractorPort as ExtractionStrategy
from app.core.config import settings
from app.domain.entities import ExtractionResult
from app.infrastructure.parsers.docx import DocxExtractor as DocxExtractionStrategy
from app.infrastructure.parsers.factory import ExtractorFactory
from app.infrastructure.parsers.pdf import PdfExtractor as PdfExtractionStrategy
from app.infrastructure.parsers.txt import TxtExtractor as TxtExtractionStrategy

TEXT_BLOCK_TYPE = 0
RATIO_EPSILON = 1e-9

__all__ = [
    "ExtractionResult",
    "ExtractionStrategy",
    "ExtractorFactory",
    "PdfExtractionStrategy",
    "DocxExtractionStrategy",
    "TxtExtractionStrategy",
    "TEXT_BLOCK_TYPE",
    "RATIO_EPSILON",
    "settings",
    "zipfile",
    "fitz",
    "docx",
]
