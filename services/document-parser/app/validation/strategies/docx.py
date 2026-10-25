"""DOCX admission: the zip container to trust, a body part to require, the
uncompressed size to bound."""

import io
import zipfile

from ..models import CorruptDocumentError, TooLargeError, ValidationOutcome
from .base import DocumentValidationStrategy

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_ZIP_LOCAL_FILE_HEADER = b"PK\x03\x04"
_DOCUMENT_PART = "word/document.xml"


class DocxValidationStrategy(DocumentValidationStrategy):
    """Admits wordprocessingml documents inside a bound-sized zip container."""

    def __init__(self, max_uncompressed_bytes: int) -> None:
        self._max_uncompressed_bytes = max_uncompressed_bytes

    def validate(self, data: bytes) -> ValidationOutcome | None:
        """Header bytes open the container; member sizes sum uncompressed,
        so a zip bomb's reputation is read from metadata before a single
        content byte is touched."""
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
        return ValidationOutcome(mime=_DOCX_MIME)
