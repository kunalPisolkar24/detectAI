"""Runtime config source for ENV_TYPE=prod: one fetch per boot from AWS.

__call__ returns one flat dict remapped to the settings field names: the
Secrets Manager blob ({"API_KEY": ...}) plus the SSM config parameters,
prefix-stripped and merged. Settings composes it in its prod source chain;
pydantic keeps the typing and the fail-closed coercion.

The constants are declared here on purpose: the service must not import deploy
tooling (tools/), and the plane contract they encode is fixed — it lives in
infra/.env.example and is seeded by tools/secrets.py.
"""

import json
import logging
import os
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from pydantic.fields import FieldInfo
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource

logger = logging.getLogger(__name__)

SECRET_NAME = "detectai/document-parser/secrets"
SSM_PREFIX = "/detectai/document-parser/"

_FETCH_FIX = "apply the plane it reads (make secrets-apply) and check the runtime role"


class ConfigSourceError(RuntimeError):
    """Boot-fatal: the prod config fetch failed; the message names the fix."""


class AwsConfigSource(PydanticBaseSettingsSource):
    """Fetches this service's values from AWS, once per boot.

    The plane speaks env names (upper snake) — the secret blob keys and the
    seeded SSM parameter names match each other; __call__ remaps them onto
    the settings field names before returning. The boto3 clients use the
    default credential chain (the runtime role on ECS) with an endpoint
    override when EMULATOR_ENDPOINT is set (Floci).
    """

    def __init__(
        self, settings_cls: type[BaseSettings], region: str, endpoint_url: str | None = None
    ) -> None:
        super().__init__(settings_cls)
        self._region = region
        self._endpoint_url = endpoint_url

    @classmethod
    def from_env(cls, settings_cls: type[BaseSettings]) -> "AwsConfigSource":
        region = os.environ.get("AWS_REGION", "").strip()
        if not region:
            raise ConfigSourceError(
                "ENV_TYPE=prod needs AWS_REGION in the environment; compose injects it from infra/.env"
            )
        endpoint = os.environ.get("EMULATOR_ENDPOINT", "").strip()
        return cls(settings_cls, region, endpoint or None)

    # Per-field lookups belong to env-style sources; this source provides the
    # whole document wholesale in __call__, so the hook never fires.
    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        raise AssertionError("AwsConfigSource provides values as one wholesale dict")

    def __call__(self) -> dict[str, Any]:
        # Build each client next to its fetch: a secret-plane failure must land
        # as its ConfigSourceError before the SSM client even exists.
        secrets = boto3.client(
            "secretsmanager", region_name=self._region, endpoint_url=self._endpoint_url
        )
        values = self._read_secret(secrets)
        ssm = boto3.client("ssm", region_name=self._region, endpoint_url=self._endpoint_url)
        values.update(self._read_parameters(ssm))
        values = self._map_to_fields(values)
        logger.info("config: resolved %d key(s) from aws region %s", len(values), self._region)
        return values

    def _map_to_fields(self, values: dict[str, str]) -> dict[str, str]:
        """Settings construction keys by field name (snake case), the plane by
        env name (upper); match case-insensitively and let unmapped keys fall
        away instead of reaching the model as unknown kwargs."""
        fields = {name.lower(): name for name in self.settings_cls.model_fields}
        mapped: dict[str, str] = {}
        for key, value in values.items():
            lowered = key.lower()
            if lowered in fields:
                mapped[fields[lowered]] = value
        return mapped

    def _read_secret(self, client: Any) -> dict[str, str]:
        try:
            response = client.get_secret_value(SecretId=SECRET_NAME)
        except (ClientError, BotoCoreError) as error:
            raise ConfigSourceError(f'could not fetch secret "{SECRET_NAME}": {error}; {_FETCH_FIX}') from error
        raw = response.get("SecretString")
        if raw is None:
            raise ConfigSourceError(
                f'secret "{SECRET_NAME}" has no SecretString value (binary or empty); {_FETCH_FIX}'
            )
        try:
            blob = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ConfigSourceError(f'secret "{SECRET_NAME}" is not a JSON blob: {error}') from error
        if not isinstance(blob, dict):
            raise ConfigSourceError(f'secret "{SECRET_NAME}" is not a JSON blob (got {type(blob).__name__})')
        return {str(key): str(value) for key, value in blob.items()}

    def _read_parameters(self, client: Any) -> dict[str, str]:
        try:
            paginator = client.get_paginator("get_parameters_by_path")
            pages = paginator.paginate(Path=SSM_PREFIX, Recursive=True)
            parameters = [element for page in pages for element in page.get("Parameters", [])]
        except (ClientError, BotoCoreError) as error:
            raise ConfigSourceError(f'could not read SSM path "{SSM_PREFIX}": {error}; {_FETCH_FIX}') from error
        values: dict[str, str] = {}
        for parameter in parameters:
            name = parameter.get("Name", "")
            key = name.removeprefix(SSM_PREFIX)
            if key:
                values[key] = str(parameter.get("Value", ""))
        return values
