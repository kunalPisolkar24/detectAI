"""The SSM plane: one paginated path fetch at construction, plain String entries only."""

from typing import Any

from ..errors import ConfigFetchError

SSM_PREFIX = "/detectai/document-parser/"

_FETCH_FIX = "apply the plane it reads (make secrets-apply) and check the runtime role"


class ParameterStoreAdapter:
    """One fetch at construction (injected client); plain non-secret parameters only."""

    def __init__(self, client: Any, *, ssm_prefix: str = SSM_PREFIX) -> None:
        self._client = client
        self._ssm_prefix = ssm_prefix
        self._values = self._fetch()

    def fetch(self) -> dict[str, str]:
        return dict(self._values)

    def get(self, key: str, default: str | None = None) -> str | None:
        return self._values.get(key, default)

    def _fetch(self) -> dict[str, str]:
        # Import-local: only a boot that actually reads this plane pays for botocore.
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
