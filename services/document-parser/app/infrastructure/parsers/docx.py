import re
import zipfile

import docx

from app.application.ports.extractor import ExtractorPort
from app.core.config import settings
from app.domain.entities import ExtractionResult
from app.domain.exceptions import DocumentTooLargeError, ExtractionError

_FIELD_CHARS = re.compile(r"[\x13\x14\x15]")


class DocxExtractor(ExtractorPort):
    def extract(self, file_path: str) -> ExtractionResult:
        try:
            self._guard_uncompressed_size(file_path)
            doc = docx.Document(file_path)
            parts: list[str] = []
            total = 0
            for para in doc.paragraphs:
                txt = _FIELD_CHARS.sub("", para.text).replace("\t", " ")
                if txt.strip():
                    parts.append(txt)
                    total += len(txt)
                if total > settings.MAX_TEXT_LENGTH:
                    break
            return ExtractionResult(text="\n".join(parts))
        except DocumentTooLargeError:
            raise
        except Exception as e:
            raise ExtractionError(f"DOCX processing failed: {e}") from e

    @staticmethod
    def _guard_size(path: str) -> None:
        with zipfile.ZipFile(path) as z:
            size = sum(i.file_size for i in z.infolist())
        if size > settings.MAX_DOCX_UNCOMPRESSED_BYTES:
            raise DocumentTooLargeError(size, settings.MAX_DOCX_UNCOMPRESSED_BYTES)

    _guard_uncompressed_size = _guard_size
