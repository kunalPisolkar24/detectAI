import math
import re
import zipfile
from collections import Counter

import fitz
import docx
from abc import ABC, abstractmethod
from app.core.config import settings
from app.core.exceptions import DocumentTooLargeError, ExtractionError

TEXT_BLOCK_TYPE = 0
RATIO_EPSILON = 1e-9
DOCX_FIELD_CONTROL_CHARS = re.compile(r"[\x13\x14\x15]")
UTF8_BOM = "\ufeff"
LATIN1_BOM = "\xef\xbb\xbf"

class ExtractionStrategy(ABC):
    @abstractmethod
    def extract(self, file_path: str) -> str:
        pass

class PdfExtractionStrategy(ExtractionStrategy):
    def extract(self, file_path: str) -> str:
        page_texts = []
        total_length = 0
        try:
            with fitz.open(file_path) as doc:
                if doc.page_count > settings.MAX_PDF_PAGES:
                    raise DocumentTooLargeError(doc.page_count, settings.MAX_PDF_PAGES)
                for page in doc:
                    text = self._extract_page_text(page)
                    if not text:
                        continue
                    page_texts.append(text)
                    total_length += len(text)
                    if total_length > settings.MAX_TEXT_LENGTH:
                        break
            return self._drop_repeated_lines(page_texts)
        except DocumentTooLargeError:
            raise
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

    @classmethod
    def _drop_repeated_lines(cls, page_texts: list[str]) -> str:
        ratio = settings.HEADER_REPETITION_RATIO
        if len(page_texts) < 2 or ratio <= 0:
            return "\n".join(page_texts)

        occurrences: Counter[str] = Counter()
        pages_lines = []
        for text in page_texts:
            lines = [(line, cls._normalize(line)) for line in text.split("\n")]
            pages_lines.append(lines)
            occurrences.update({normalized for _, normalized in lines if normalized})

        min_pages = math.ceil(ratio * len(pages_lines) - RATIO_EPSILON)
        kept = [
            line
            for lines in pages_lines
            for line, normalized in lines
            if not normalized or occurrences[normalized] < min_pages
        ]
        return "\n".join(kept)

    @staticmethod
    def _normalize(line: str) -> str:
        return " ".join(line.split())

class DocxExtractionStrategy(ExtractionStrategy):
    def extract(self, file_path: str) -> str:
        try:
            self._guard_uncompressed_size(file_path)
            doc = docx.Document(file_path)
            text_content = []
            total_length = 0
            for para in doc.paragraphs:
                text = self._clean_inline(para.text)
                if text.strip():
                    text_content.append(text)
                    total_length += len(text)
                if total_length > settings.MAX_TEXT_LENGTH:
                    break
            return "\n".join(text_content)
        except DocumentTooLargeError:
            raise
        except Exception as e:
            raise ExtractionError(f"DOCX processing failed: {str(e)}")

    @staticmethod
    def _guard_uncompressed_size(file_path: str) -> None:
        with zipfile.ZipFile(file_path) as archive:
            uncompressed_bytes = sum(info.file_size for info in archive.infolist())
        if uncompressed_bytes > settings.MAX_DOCX_UNCOMPRESSED_BYTES:
            raise DocumentTooLargeError(uncompressed_bytes, settings.MAX_DOCX_UNCOMPRESSED_BYTES)

    @classmethod
    def _clean_inline(cls, text: str) -> str:
        return DOCX_FIELD_CONTROL_CHARS.sub("", text).replace("\t", " ")

class TxtExtractionStrategy(ExtractionStrategy):
    def extract(self, file_path: str) -> str:
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            try:
                return content.decode("utf-8").removeprefix(UTF8_BOM)
            except UnicodeDecodeError:
                return content.decode("latin-1").removeprefix(LATIN1_BOM)
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
