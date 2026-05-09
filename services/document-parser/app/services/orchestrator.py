import os
import tempfile
from fastapi import UploadFile
from app.services.strategies import ExtractorFactory
from app.utils.cleaner import TextCleaner

class ExtractionOrchestrator:
    @staticmethod
    def process_file(file: UploadFile) -> str:
        suffix = os.path.splitext(file.filename or "")[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            try:
                content = file.file.read()
                tmp.write(content)
                tmp.flush()
                tmp_path = tmp.name
                
                strategy = ExtractorFactory.get_strategy(file.content_type or "")
                raw_text = strategy.extract(tmp_path)
                return TextCleaner.clean(raw_text)
            finally:
                if 'tmp_path' in locals() and os.path.exists(tmp_path):
                    os.unlink(tmp_path)
