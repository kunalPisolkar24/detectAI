"""The config plane contract: one interface, two planes, one lookup behavior.

ConfigProvider is what callers depend on. DevConfig answers from the parsed
dotenv plane; ProdConfig from the merged AWS planes (SSM wins collisions,
the secrets blob fills the gaps). Both planes are read once at construction;
lookups afterwards never touch the network or disk. Dependencies point one
way: provider -> adapters, never factories -> back.
"""

from abc import ABC, abstractmethod

from .adapters.dotenv import DotEnvAdapter
from .adapters.parameters import ParameterStoreAdapter
from .adapters.secrets_manager import SecretsManagerAdapter
from .errors import ConfigError


class MissingKeyError(ConfigError):
    """A required key did not resolve on its plane; the message names both."""


class ConfigProvider(ABC):
    """Contract every config plane answers: optional and mandatory lookups."""

    @abstractmethod
    def get(self, key: str, default: str | None = None) -> str | None:
        """Optional key: absence is a normal answer (None), never an error."""

    @abstractmethod
    def require(self, key: str) -> str:
        """Mandatory key: absence raises MissingKeyError naming key and plane."""


class _DictConfig(ConfigProvider):
    """Shared mechanics: lookup behavior over one in-memory dict per plane."""

    def __init__(self, plane: str) -> None:
        self._plane = plane

    def get(self, key: str, default: str | None = None) -> str | None:
        raise NotImplementedError

    def require(self, key: str) -> str:
        raise NotImplementedError


class DevConfig(_DictConfig):
    """The dev plane: keys as written in the .env file the adapter parsed.

    Constructed with one DotEnvAdapter, which parses eagerly and raises a
    loud DotEnvError for an unreadable plane; construction then hands the
    pairs to the dict, so get/require below are pure memory.
    """

    def __init__(self, dotenv: DotEnvAdapter) -> None:
        super().__init__("dev")
        self._dotenv = dotenv


class ProdConfig(_DictConfig):
    """The prod plane: SSM parameters first on collision, then the blob fill.

    Constructed with both AWS adapters, which fetch their planes exactly
    once at their construction; this class merges them eagerly for the same
    rule — lookups never touch the network. Keys seeded after boot stay
    invisible until a restart.
    """

    def __init__(
        self, parameters: ParameterStoreAdapter, secrets: SecretsManagerAdapter
    ) -> None:
        super().__init__("prod")
        self._parameters = parameters
        self._secrets = secrets
