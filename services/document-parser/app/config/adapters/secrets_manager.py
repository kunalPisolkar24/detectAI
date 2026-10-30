"""The secrets blob plane: one fetch at construction, a JSON object of env-named keys."""

import json
from typing import Any

from ..errors import ConfigFetchError

SECRET_NAME = "detectai/document-parser/secrets"

_FETCH_FIX = "apply the plane it reads (make secrets-apply) and check the runtime role"


class SecretsManagerAdapter:
    """One fetch at construction (injected client); secrets only, never the parameter tree."""

    def __init__(self, client: Any, *, secret_name: str = SECRET_NAME) -> None:
        self._client = client
        self._secret_name = secret_name
        self._values = self._fetch()

    def fetch(self) -> dict[str, str]:
        return dict(self._values)

    def get(self, key: str, default: str | None = None) -> str | None:
        return self._values.get(key, default)

    def _fetch(self) -> dict[str, str]:
        # Import-local: only a boot that actually reads this plane pays for botocore.
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            response = self._client.get_secret_value(SecretId=self._secret_name)
        except (BotoCoreError, ClientError) as error:
            raise ConfigFetchError(
                f'could not fetch secret "{self._secret_name}": {error}; {_FETCH_FIX}'
            ) from error
        raw = response.get("SecretString")
        if raw is None:
            raise ConfigFetchError(
                f'secret "{self._secret_name}" has no SecretString value (binary or empty); {_FETCH_FIX}'
            )
        try:
            blob = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ConfigFetchError(f'secret "{self._secret_name}" is not a JSON blob: {error}') from error
        if not isinstance(blob, dict):
            raise ConfigFetchError(f'secret "{self._secret_name}" is not a JSON blob (got {type(blob).__name__})')
        return {str(key): str(value) for key, value in blob.items()}
