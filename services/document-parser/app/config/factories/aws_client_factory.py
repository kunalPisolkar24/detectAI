"""Shared boto3 plumbing for the prod config plane."""

import os
from typing import Any

from ..errors import ConfigFetchError


class AWSClientFactory:
    """Credentials ride boto3's default chain; clients are injected — tests use plain fakes."""

    def __init__(self, region: str) -> None:
        self._region = region

    @classmethod
    def from_env(cls) -> "AWSClientFactory":
        region = os.environ.get("AWS_REGION", "").strip()
        if not region:
            raise ConfigFetchError(
                "the prod plane needs AWS_REGION in the environment; compose injects it from infra/.env"
            )
        return cls(region)

    def create_client(self, service: str) -> Any:
        import boto3  # method-local: only a prod-plane boot pays for the import

        return boto3.client(service, region_name=self._region)
