"""SecretsManagerAdapter: the secrets blob as one in-memory dict per boot.

Plane contract: the blob is a JSON object of env-named keys
({"API_KEY": ...}). Construction performs the single fetch —
get_secret_value, SecretString present, parsed into dict[str, str].
Missing secret, missing SecretString (binary or empty), non-JSON, or a
non-object blob all raise ConfigFetchError naming the secret and the fix;
the contract is fail-closed in every plane.
"""

import json
from typing import Any

from ..errors import ConfigFetchError

SECRET_NAME = "detectai/document-parser/secrets"

_FETCH_FIX = "apply the plane it reads (make secrets-apply) and check the runtime role"


class SecretsManagerAdapter:
    """Reads the secrets blob once, then answers from memory.

    The boto3 client is injected (built by AWSClientFactory or faked in
    tests). ParameterStoreAdapter owns the non-secret tree; this adapter is
    for secrets only.
    """

    def __init__(self, client: Any, *, secret_name: str = SECRET_NAME) -> None:
        self._client = client
        self._secret_name = secret_name
        self._values = self._fetch()

    def fetch(self) -> dict[str, str]:
        """Every blob key, as written in the secret; a copy, so callers
        cannot mutate the cache."""
        return dict(self._values)

    def get(self, key: str, default: str | None = None) -> str | None:
        """Dict-style lookup over the cached blob; never touches network."""
        return self._values.get(key, default)

    def _fetch(self) -> dict[str, str]:
        # botocore stays import-local like boto3 in the client factory: only
        # a boot that actually reads this plane pays for the import.
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
