class SeedException(Exception):
    """Base exception for seed-secrets tool."""


class EnvParseError(SeedException):
    pass


class SecretsWriteError(SeedException):
    pass


class GuardError(SeedException):
    """Raised when operation is blocked by safety guard."""
