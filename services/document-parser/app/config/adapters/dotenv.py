"""DotEnv plane reader: one in-memory parse per adapter, no process-env effects.

Lookups take place against the cached pairs; nothing is ever written to
os.environ. The plane path resolves once at construction: an explicit path
(constructor argument or the DOTENV_PATH override) is used as given and
fails loud when missing, while the package-anchored default may be absent —
a container holds no dotenv file at all, since compose injects the values
into the process environment.
"""

import logging
import os
from pathlib import Path

from dotenv import dotenv_values

from ..errors import ConfigError

logger = logging.getLogger(__name__)

DOTENV_PATH_VAR = "DOTENV_PATH"

# Anchored to the package, never the process working directory: uvicorn and
# pytest must find the same plane from any CWD. In the container the default
# lands on /app/infra/.env, which no deployed image ships by design.
_DEFAULT_DOTENV_PATH = Path(__file__).resolve().parents[3] / "infra" / ".env"

_FETCH_FIX = "create it with make env (copies infra/.env.example) or point the path at the right plane"


class DotEnvError(ConfigError):
    """The .env plane could not be read; the message names the path and the fix."""


class DotEnvAdapter:
    """Parses the .env file once at construction, then answers from memory.

    A missing plane is a loud DotEnvError when the path was explicit
    (constructor argument or DOTENV_PATH) — configuration that fails names
    itself — and an empty plane when only the untouched default is absent.
    Pure and read-only: values are returned exactly as written in the file
    (quoting and inline comments are python-dotenv's job); bare keys without
    a value are dropped. The file is never re-read after construction.
    """

    def __init__(self, path: str | Path | None = None) -> None:
        explicit: str | None = str(path) if path is not None else None
        if explicit is None:
            explicit = os.environ.get(DOTENV_PATH_VAR, "").strip() or None
        self._explicit = explicit is not None
        self._path = Path(explicit) if explicit is not None else _DEFAULT_DOTENV_PATH
        self._values = self._parse()

    def fetch(self) -> dict[str, str]:
        """Every parsed KEY=VALUE pair; a copy, so callers cannot mutate the cache."""
        return dict(self._values)

    def get(self, key: str, default: str | None = None) -> str | None:
        """One key, dict-style: None when absent unless a default is given."""
        return self._values.get(key, default)

    def _parse(self) -> dict[str, str]:
        if not self._path.is_file():
            if self._explicit:
                raise DotEnvError(
                    f'could not read the dotenv plane "{self._path}": '
                    f"missing or not a file; {_FETCH_FIX}"
                )
            logger.info(
                "no dev dotenv plane at %s; values come from the process environment",
                self._path,
            )
            return {}
        try:
            parsed = dotenv_values(self._path)
        except (OSError, ValueError) as error:
            raise DotEnvError(
                f'could not read the dotenv plane "{self._path}": {error}; {_FETCH_FIX}'
            ) from error
        return {key: value for key, value in parsed.items() if value is not None}
