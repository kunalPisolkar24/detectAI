"""Upload admission: the boundary between transport and content judgment.

api/extract.py consumes DocumentValidationService; strategies/ owns
per-type recognition; models.py is the shared vocabulary. The package
imports nothing beyond the standard library, so the unit suite pins it
without booting the app (mk/tests.mk keeps that boundary hard).
"""

from .models import UnsupportedTypeError, ValidationOutcome
from .service import DocumentValidationService, build_default_service

__all__ = [
    "DocumentValidationService",
    "UnsupportedTypeError",
    "ValidationOutcome",
    "build_default_service",
]
