"""The observability build: the seam outside callers depend on, and the
factory the composition root drives. Nothing outside the package imports it
except through these exports (observability.md's dependency view).
"""

from .contract import (
    ExtractionOutcome,
    NullObservability,
    Observability,
    RejectionReason,
)
from .service import ObservabilityService, build_observability_service

__all__ = [
    "ExtractionOutcome",
    "NullObservability",
    "Observability",
    "ObservabilityService",
    "RejectionReason",
    "build_observability_service",
]
