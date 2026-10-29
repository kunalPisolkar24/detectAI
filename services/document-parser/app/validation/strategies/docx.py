"""DOCX admission: a zip container under the uncompressed bound, body part required."""

import io
import zipfile

from ..models import DOCX_MIME, CorruptDocumentError, TooLargeError, ValidationOutcome
from .base import DocumentValidationStrategy

_ZIP_LOCAL_FILE_HEADER = b"PK\x03\x04"
_DOCUMENT_PART = "word/document.xml"


class DocxValidationStrategy(DocumentValidationStrategy):
    def __init__(self, max_uncompressed_bytes: int) -> None:
        self._max_uncompressed_bytes = max_uncompressed_bytes

    def validate(self, data: bytes) -> ValidationOutcome | None:
        """Zip-bomb bound read from member metadata before any content byte."""
        if not data.startswith(_ZIP_LOCAL_FILE_HEADER):
            return None
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as container:
                if _DOCUMENT_PART not in container.namelist():
                    raise CorruptDocumentError("the docx container carries no document body")
                uncompressed = sum(info.file_size for info in container.infolist())
        except (zipfile.BadZipFile, OSError) as error:
            raise CorruptDocumentError("the docx container did not open") from error
        if uncompressed > self._max_uncompressed_bytes:
            raise TooLargeError(
                f"the docx exceeds the {self._max_uncompressed_bytes}-byte uncompressed limit"
            )
        return ValidationOutcome(mime=DOCX_MIME)
