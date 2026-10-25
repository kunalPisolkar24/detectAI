"""The config plane contract: one interface, two planes, optional lookups.

ConfigProvider is what callers depend on. DevConfig answers from the merged
dotenv file and process environment (env wins: containers ship no file and
receive their values injected as env vars). ProdConfig answers from the
merged AWS planes — the secrets blob first, then SSM; the two are disjoint
by seeding contract, so an overlapping key fails the boot loudly instead of
silently picking a winner. Both planes are read exactly once at
construction; lookups afterwards never touch the network or disk.
Dependencies point one way: provider -> adapters, never factories -> back.
"""

import os
from abc import ABC, abstractmethod
from typing import Protocol

from .adapters.dotenv import DotEnvAdapter
from .errors import ConfigError


class ConfigProvider(ABC):
    """Contract every config plane answers; absence is a normal answer."""

    @abstractmethod
    def get(self, key: str, default: str | None = None) -> str | None:
        """Optional key: absence is a normal answer (None), never an error."""


class AwsPlane(Protocol):
    """The one operation the prod plane needs from a constructed AWS
    adapter: its seeded keys, fetched exactly once at the adapter's own
    construction. The concrete adapters satisfy this structurally."""

    def fetch(self) -> dict[str, str]: ...


class _DictConfig(ConfigProvider):
    """Shared mechanics: lookups over one in-memory dict built per plane."""

    def __init__(self, plane: str, values: dict[str, str]) -> None:
        self._plane = plane
        self._values = values

    def get(self, key: str, default: str | None = None) -> str | None:
        return self._values.get(key, default)


class DevConfig(_DictConfig):
    """The dev plane: process environment over the parsed .env file.

    Env wins because a container has no file at all — compose injects the
    values as environment variables — while locally the file is the baseline
    and an export still override it, as it always has. The file is parsed
    once by the adapter; this merge is the only work done at construction.
    """

    def __init__(self, dotenv: DotEnvAdapter) -> None:
        super().__init__("dev", {**dotenv.fetch(), **os.environ})


class ProdConfig(_DictConfig):
    """The prod plane: the secrets blob fills first, SSM parameters complete.

    Constructed with both AWS adapters, which fetched their planes exactly
    once at their own construction; this merge is pure memory. The seeding
    contract keeps the two planes disjoint (tools/secrets.py: the blob
    carries API_KEY, only allowlisted non-secret keys land in SSM), so a
    collision — checked case-insensitively — is operator error and fails the
    boot naming the key and the fix. Keys seeded after boot stay invisible
    until a restart.
    """

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
