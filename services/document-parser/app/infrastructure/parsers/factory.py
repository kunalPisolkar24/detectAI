from app.application.ports.extractor import ExtractorPort
from app.domain.exceptions import ExtractionError
from app.infrastructure.parsers.docx import DocxExtractor
from app.infrastructure.parsers.pdf import PdfExtractor
from app.infrastructure.parsers.txt import TxtExtractor


class ExtractorFactory:
    _map: dict[str, ExtractorPort] = {
        "application/pdf": PdfExtractor(),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": DocxExtractor(),
        "text/plain": TxtExtractor(),
    }

    @classmethod
    def get(cls, mime: str) -> ExtractorPort:
        ext = cls._map.get(mime)
        if not ext:
            raise ExtractionError(f"No strategy found for {mime}")
        return ext

    @classmethod
    def get_strategy(cls, mime: str) -> ExtractorPort:
        return cls.get(mime)
