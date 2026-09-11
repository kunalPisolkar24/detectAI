from app.api.deps import validate_upload
from app.core.config import settings as _settings
from app.infrastructure.mime.magic_detector import MagicMimeDetector

_detector = MagicMimeDetector()


def get_settings():
    return _settings


def get_mime_detector():
    return _detector


__all__ = ["validate_upload", "get_settings", "get_mime_detector"]
