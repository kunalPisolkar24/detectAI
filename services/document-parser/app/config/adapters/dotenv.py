"""DotEnv plane reader: one in-memory parse per adapter, no process-env effects.

Looks take place against the cached pairs; nothing is ever written to
os.environ, and Settings keeps its own pydantic-driven read of the file.
A missing or unreadable plane is a loud error — run `make env` first.
"""

from pathlib import Path

from dotenv import dotenv_values

from ..errors import ConfigError

# Resolved against the process working directory, matching how Settings'
# env_file="infra/.env" behaves today.
INFRA_ENV_PATH = Path("infra/.env")

_FETCH_FIX = "create it with make env (copies infra/.env.example) or point the path at the right plane"


class DotEnvError(ConfigError):
    """The .env plane could not be read; the message names the path and the fix."""


class DotEnvAdapter:
    """Parses the .env file once at construction, then answers from memory.

    Pure and read-only: values are returned exactly as written in the file
    (quoting and inline comments are python-dotenv's job); bare keys without
    a value are dropped. The file is never re-read after construction.
    """

    def __init__(self, path: str | Path = INFRA_ENV_PATH) -> None:
        self._path = Path(path)
        self._values = self._parse()

    def fetch(self) -> dict[str, str]:
        """Every parsed KEY=VALUE pair; a copy, so callers cannot mutate the cache."""
        return dict(self._values)

    def get(self, key: str, default: str | None = None) -> str | None:
        """One key, dict-style: None when absent unless a default is given."""
        return self._values.get(key, default)

    def _parse(self) -> dict[str, str]:
        if not self._path.is_file():
            raise DotEnvError(
                f'could not read the dotenv plane "{self._path}": '
                f"missing or not a file; {_FETCH_FIX}"
            )
        try:
            parsed = dotenv_values(self._path)
        except (OSError, ValueError) as error:
            raise DotEnvError(
                f'could not read the dotenv plane "{self._path}": {error}; {_FETCH_FIX}'
            ) from error
        return {key: value for key, value in parsed.items() if value is not None}
