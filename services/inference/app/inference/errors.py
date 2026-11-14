"""The inference plane's shared error vocabulary; the root every plane failure hangs from."""


class InferenceError(RuntimeError):
    """Root of the inference plane's failures; catch this for blanket handling."""
