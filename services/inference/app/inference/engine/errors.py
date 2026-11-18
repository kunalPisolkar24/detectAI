"""The engine's raiser; one typed failure for every engine fault."""

from ..errors import InferenceError


class EngineError(InferenceError):
    """The engine could not produce a score for a well-formed request."""
