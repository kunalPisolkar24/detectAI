"""The config plane contract: one interface, two planes, read once each at construction."""

import os
from abc import ABC, abstractmethod
from typing import Protocol

from .adapters.dotenv import DotEnvAdapter
from .errors import ConfigError


class ConfigProvider(ABC):
    @abstractmethod
    def get(self, key: str, default: str | None = None) -> str | None:
        """Absence is a normal answer (None), never an error."""


class AwsPlane(Protocol):
    """Fetch happens once, at the adapter's own construction; satisfied structurally."""

    def fetch(self) -> dict[str, str]: ...


class _DictConfig(ConfigProvider):
    def __init__(self, plane: str, values: dict[str, str]) -> None:
        self._plane = plane
        self._values = values

    def get(self, key: str, default: str | None = None) -> str | None:
        return self._values.get(key, default)


class DevConfig(_DictConfig):
    """Env wins over the file: a container carries no file at all."""

    def __init__(self, dotenv: DotEnvAdapter) -> None:
        super().__init__("dev", {**dotenv.fetch(), **os.environ})


class ProdConfig(_DictConfig):
    """Planes are disjoint by seeding contract — a collision is operator error;
    keys seeded after boot stay invisible until restart."""

    def __init__(self, parameters: AwsPlane, secrets: AwsPlane) -> None:
        blob = secrets.fetch()
        ssm = parameters.fetch()
        overlap = {key.lower() for key in blob} & {key.lower() for key in ssm}
        if overlap:
            names = ", ".join(sorted(overlap))
            raise ConfigError(
                f'key(s) seeded on both planes: {names}; the secrets blob and the SSM prefix '
                "are disjoint by contract — remove the duplicates and re-apply (make secrets-apply)"
            )
        super().__init__("prod", {**blob, **ssm})
