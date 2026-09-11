import os
import tempfile

from app.application.ports.file_store import FileStorePort


class TempFileStore(FileStorePort):
    def save(self, content: bytes, suffix: str) -> str:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp.flush()
            return tmp.name

    def cleanup(self, path: str) -> None:
        try:
            if os.path.exists(path):
                os.unlink(path)
        except Exception:
            pass
