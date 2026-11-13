"""Shared preprocessing error vocabulary; colocate in its raiser, graduate here with a second."""


class PreprocessingError(RuntimeError):
    """Root of the preprocessing plane's failures; catch this for blanket handling."""


class InvalidDocument(PreprocessingError):
    """The submission cannot be analysed: empty, blank, or over the character bound."""
