"""The inference plane's shared error vocabulary; the root every plane failure hangs from."""


class InferenceError(RuntimeError):
    """Root of the inference plane's failures; catch this for blanket handling."""


class OverloadedError(InferenceError):
    """The model is saturated, or the service is draining: the request is shed."""


class UnknownModelError(InferenceError):
    """The request named a model the service does not serve."""
