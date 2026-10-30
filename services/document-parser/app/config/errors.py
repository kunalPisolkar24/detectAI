"""Shared config error vocabulary; colocate in its raiser, graduate here with a second."""


class ConfigError(RuntimeError):
    """Root of the config plane's failures; catch this for blanket handling."""


class ConfigFetchError(ConfigError):
    """A config plane could not be read; the message names the stack and fix."""
