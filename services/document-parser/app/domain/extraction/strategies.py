import fitz
import docx
from abc import ABC, abstractmethod
from app.core.config import settings
from app.core.exceptions import ExtractionError

TEXT_BLOCK_TYPE = 0

class ExtractionStrategy(ABC):
    @abstractmethod
    def extract(self, file_path: str) -> str:
        pass

class PdfExtractionStrategy(ExtractionStrategy):
    def extract(self, file_path: str) -> str:
        text_content = []
        total_length = 0
        try:
            with fitz.open(file_path) as doc:
                for page in doc:
                    text = self._extract_page_text(page)
                    if not text:
                        continue
                    text_content.append(text)
                    total_length += len(text)
                    if total_length > settings.MAX_TEXT_LENGTH:
                        break
            return "\n".join(text_content)
        except Exception as e:
            raise ExtractionError(f"PDF processing failed: {str(e)}")

    @staticmethod
    def _extract_page_text(page) -> str:
        blocks = page.get_text("blocks")
        kept = [
            block[4]
            for block in blocks
            if block[6] == TEXT_BLOCK_TYPE and not PdfExtractionStrategy._in_margin_band(block, page.rect.height)
        ]
        return "\n".join(kept)

    @staticmethod
    def _in_margin_band(block, page_height: float) -> bool:
        y0, y1 = block[1], block[3]
        return (
            y1 <= settings.HEADER_FOOTER_MARGIN_PT
            or y0 >= page_height - settings.HEADER_FOOTER_MARGIN_PT
        )

class DocxExtractionStrategy(ExtractionStrategy):
    def extract(self, file_path: str) -> str:
        try:
            doc = docx.Document(file_path)
            text_content = []
            total_length = 0
            for para in doc.paragraphs:
                if para.text.strip():
                    text_content.append(para.text)
                    total_length += len(para.text)
                if total_length > settings.MAX_TEXT_LENGTH:
                    break
            return "\n".join(text_content)
        except Exception as e:
            raise ExtractionError(f"DOCX processing failed: {str(e)}")

class TxtExtractionStrategy(ExtractionStrategy):
    def extract(self, file_path: str) -> str:
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            try:
                return content.decode("utf-8")
            except UnicodeDecodeError:
                return content.decode("latin-1")
        except Exception as e:
            raise ExtractionError(f"Text decoding failed: {str(e)}")

class ExtractorFactory:
    _strategies: dict[str, ExtractionStrategy] = {
        "application/pdf": PdfExtractionStrategy(),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": DocxExtractionStrategy(),
        "text/plain": TxtExtractionStrategy(),
    }

    @classmethod
    def get_strategy(cls, mime_type: str) -> ExtractionStrategy:
        strategy = cls._strategies.get(mime_type)
        if not strategy:
            raise ExtractionError(f"No strategy found for {mime_type}")
        return strategy
