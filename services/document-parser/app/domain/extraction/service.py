import os
import tempfile
from fastapi import UploadFile
from app.domain.extraction.strategies import ExtractorFactory
from app.domain.extraction.cleaner import TextCleaner

class ExtractionService:
    @staticmethod
    def process_file(file: UploadFile) -> str:
        suffix = os.path.splitext(file.filename or "")[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            try:
                content = file.file.read()
                tmp.write(content)
                tmp.flush()

                strategy = ExtractorFactory.get_strategy(file.content_type or "")
                raw_text = strategy.extract(tmp_path)
                return TextCleaner.clean(raw_text)
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
