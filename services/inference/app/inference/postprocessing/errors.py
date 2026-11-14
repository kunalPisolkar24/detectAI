"""The postprocessing plane's raiser; one typed failure for every aggregation fault."""

from ..errors import InferenceError


class PostprocessingError(InferenceError):
    """The scored regions could not be aggregated into a verdict."""
