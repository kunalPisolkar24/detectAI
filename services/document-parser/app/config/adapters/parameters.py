"""ParameterStoreAdapter: the SSM config tree as one in-memory dict per boot.

Plane contract: keys are tree names minus the prefix, upper snake as seeded.
Construction performs the single fetch — paginated get_parameters_by_path
over the prefix (Recursive=True, plain parameters only, no WithDecryption);
a path with zero parameters is an empty plane, not an error. Amazon-side
failures raise ConfigFetchError naming the path and the fix.
"""

from typing import Any

SSM_PREFIX = "/detectai/document-parser/"


class ParameterStoreAdapter:
    """Reads the SSM parameter tree once, then answers from memory.

    The boto3 client is injected (built by AWSClientFactory or faked in
    tests). Secrets are out of scope: SecretsManagerAdapter owns them; SSM
    holds only plain parameters on this plane.
    """

    def __init__(self, client: Any, *, ssm_prefix: str = SSM_PREFIX) -> None:
        self._client = client
        self._ssm_prefix = ssm_prefix

    def fetch(self) -> dict[str, str]:
        """Every seeded key, prefix-stripped; a copy, so callers cannot
        mutate the cache."""
        raise NotImplementedError

    def get(self, key: str, default: str | None = None) -> str | None:
        """Dict-style lookup over the cached plane; never touches network."""
        raise NotImplementedError
