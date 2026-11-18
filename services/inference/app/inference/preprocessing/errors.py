"""Shared preprocessing error vocabulary; the preparation plane's leaves of the plane root."""

from ..errors import InferenceError


class PreprocessingError(InferenceError):
    """The preparation plane's failures; catch this for that plane alone."""


class InvalidDocument(PreprocessingError):
    """The submission cannot be analysed: empty, blank, or over the character bound."""
