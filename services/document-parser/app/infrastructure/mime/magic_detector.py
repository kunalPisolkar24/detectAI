import magic

from app.application.ports.mime_detector import MimeDetectorPort


class MagicMimeDetector(MimeDetectorPort):
    def detect(self, header: bytes) -> str:
        return magic.from_buffer(header, mime=True)
