"""SecretsManagerAdapter: the secrets blob as one in-memory dict per boot.

Plane contract: the blob is a JSON object of env-named keys. Construction
performs the single fetch — get_secret_value, SecretString present, parsed
into dict[str, str]. Missing secret, missing SecretString (binary or
empty), non-JSON, or a non-object blob all raise ConfigFetchError naming
the secret and the fix; the contract is fail-closed in every plane.
"""

from typing import Any

SECRET_NAME = "detectai/document-parser/secrets"


class SecretsManagerAdapter:
    """Reads the secrets blob once, then answers from memory.

    The boto3 client is injected (built by AWSClientFactory or faked in
    tests). ParameterStoreAdapter owns the non-secret tree; this adapter is
    for secrets only.
    """

    def __init__(self, client: Any, *, secret_name: str = SECRET_NAME) -> None:
        self._client = client
        self._secret_name = secret_name

    def fetch(self) -> dict[str, str]:
        """Every blob key, as written in the secret; a copy, so callers
        cannot mutate the cache."""
        raise NotImplementedError

    def get(self, key: str, default: str | None = None) -> str | None:
        """Dict-style lookup over the cached blob; never touches network."""
        raise NotImplementedError
