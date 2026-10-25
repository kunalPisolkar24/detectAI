"""Shared config error vocabulary: one catch point for the whole plane.

Organizing policy: the root lives here forever; an error colocates in the
module of its only raiser and graduates here the moment a second raiser
appears. Everything the config plane raises is a ConfigError — catching it
covers file, network, and lookup failures alike.
"""


class ConfigError(RuntimeError):
    """Root of the config plane's failures; catch this for blanket handling."""


class ConfigFetchError(ConfigError):
    """A config plane could not be read; the message names the stack and fix."""
