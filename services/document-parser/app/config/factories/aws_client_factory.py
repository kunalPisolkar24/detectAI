"""Shared boto3 plumbing for the prod config plane: decided once, reused.

Region and endpoint are read exactly once (from_env) and shared by every
client built here, so all plane clients target one account and the same
emulator override. boto3 stays method-local: dev boots never import it.
"""

from typing import Any


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
        raise NotImplementedError

    def create_client(self, service: str) -> Any:
        """One boto3 client per service (ssm, secretsmanager) with shared
        region and endpoint kwargs."""
        raise NotImplementedError
