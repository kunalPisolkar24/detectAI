"""Shared boto3 plumbing for the prod config plane: decided once, reused.

Region and endpoint are read exactly once (from_env) and shared by every
client built here, so all plane clients target one region and the same
emulator override. boto3 stays method-local: dev boots never import it.
"""

import os
from typing import Any

from ..errors import ConfigFetchError


class AWSClientFactory:
    """Client factory for the config plane's own AWS reads.

    Credentials come from boto3's default chain (the task role on ECS);
    EMULATOR_ENDPOINT overrides the endpoint for the emulator plane. Clients
    are built per service and injected into the adapters — tests answer with
    plain fakes, no boto3 monkeypatching.
    """

    def __init__(self, region: str, *, endpoint_url: str | None = None) -> None:
        self._region = region
        self._endpoint_url = endpoint_url

    @classmethod
    def from_env(cls) -> "AWSClientFactory":
        """AWS_REGION required — empty or missing fails with a ConfigFetchError
        naming the var (compose injects it from infra/.env); EMULATOR_ENDPOINT
        optional, whitespace-trimmed, None when unset.
        """
        region = os.environ.get("AWS_REGION", "").strip()
        if not region:
            raise ConfigFetchError(
                "the prod plane needs AWS_REGION in the environment; compose injects it from infra/.env"
            )
        endpoint = os.environ.get("EMULATOR_ENDPOINT", "").strip()
        return cls(region, endpoint_url=endpoint or None)

    def create_client(self, service: str) -> Any:
        """One boto3 client per service (ssm, secretsmanager) with shared
        region and endpoint kwargs."""
        import boto3  # method-local: only a prod-plane boot pays for the import

        return boto3.client(service, region_name=self._region, endpoint_url=self._endpoint_url)
