import fitz
import docx
import io
from abc import ABC, abstractmethod
from app.config import settings
from app.exceptions import ExtractionError

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
                    text = page.get_text()
                    text_content.append(text)
                    total_length += len(text)
                    if total_length > settings.MAX_TEXT_LENGTH:
                        break
            return "\n".join(text_content)
        except Exception as e:
            raise ExtractionError(f"PDF processing failed: {str(e)}")

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
    _strategies = {
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
