from app.application.ports.extractor import ExtractorPort
from app.domain.entities import ExtractionResult
from app.domain.exceptions import ExtractionError

_UTF8_BOM = "\ufeff"
_LATIN1_BOM = "\xef\xbb\xbf"


class TxtExtractor(ExtractorPort):
    def extract(self, file_path: str) -> ExtractionResult:
        try:
            with open(file_path, "rb") as f:
                data = f.read()
            try:
                return ExtractionResult(text=data.decode("utf-8").removeprefix(_UTF8_BOM))
            except UnicodeDecodeError:
                return ExtractionResult(text=data.decode("latin-1").removeprefix(_LATIN1_BOM))
        except Exception as e:
            raise ExtractionError(f"Text decoding failed: {e}") from e
