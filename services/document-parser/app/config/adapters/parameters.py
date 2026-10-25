"""ParameterStoreAdapter: the SSM config tree as one in-memory dict per boot.

Plane contract: keys are tree names minus the prefix, upper snake as seeded,
String parameters only (a SecureString is operator error, not config — it
fails loud instead of handing the model encrypted ciphertext). Construction
performs the single fetch — paginated get_parameters_by_path over the prefix
(Recursive=True, no WithDecryption); a path with zero parameters is an empty
plane, not an error. Amazon-side failures raise ConfigFetchError naming the
path and the fix.
"""

from typing import Any

from ..errors import ConfigFetchError

SSM_PREFIX = "/detectai/document-parser/"

_FETCH_FIX = "apply the plane it reads (make secrets-apply) and check the runtime role"


class ParameterStoreAdapter:
    """Reads the SSM parameter tree once, then answers from memory.

    The boto3 client is injected (built by AWSClientFactory or faked in
    tests). Secrets are out of scope: SecretsManagerAdapter owns them; SSM
    holds only plain parameters on this plane.
    """

    def __init__(self, client: Any, *, ssm_prefix: str = SSM_PREFIX) -> None:
        self._client = client
        self._ssm_prefix = ssm_prefix
        self._values = self._fetch()

    def fetch(self) -> dict[str, str]:
        """Every seeded key, prefix-stripped; a copy, so callers cannot
        mutate the cache."""
        return dict(self._values)

    def get(self, key: str, default: str | None = None) -> str | None:
        """Dict-style lookup over the cached plane; never touches network."""
        return self._values.get(key, default)

    def _fetch(self) -> dict[str, str]:
        # botocore stays import-local like boto3 in the client factory: only
        # a boot that actually reads this plane pays for the import.
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            paginator = self._client.get_paginator("get_parameters_by_path")
            pages = paginator.paginate(Path=self._ssm_prefix, Recursive=True, WithDecryption=False)
            parameters = [entry for page in pages for entry in page.get("Parameters", [])]
        except (BotoCoreError, ClientError) as error:
            raise ConfigFetchError(
                f'could not read the SSM path "{self._ssm_prefix}": {error}; {_FETCH_FIX}'
            ) from error
        values: dict[str, str] = {}
        for parameter in parameters:
            name = str(parameter.get("Name", ""))
            if parameter.get("Type") == "SecureString":
                raise ConfigFetchError(
                    f'parameter "{name}" under "{self._ssm_prefix}" is SecureString; '
                    "the config plane holds plain String entries only — "
                    "secrets belong in the secrets blob"
                )
            key = name.removeprefix(self._ssm_prefix)
            if key:
                values[key] = str(parameter.get("Value", ""))
        return values
