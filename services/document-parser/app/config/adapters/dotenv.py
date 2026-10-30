"""The dotenv plane reader: one in-memory parse, nothing ever written to os.environ."""

import logging
import os
from pathlib import Path

from dotenv import dotenv_values

from ..errors import ConfigError

logger = logging.getLogger(__name__)

DOTENV_PATH_VAR = "DOTENV_PATH"

# Anchored to the package, never the CWD, so uvicorn and pytest find the same plane.
_DEFAULT_DOTENV_PATH = Path(__file__).resolve().parents[3] / "infra" / ".env"

_FETCH_FIX = "create it with make env (copies infra/.env.example) or point the path at the right plane"


class DotEnvError(ConfigError):
    """The .env plane could not be read; the message names the path and the fix."""


class DotEnvAdapter:
    """A missing explicit path fails loudly; the absent default is an empty plane."""

    def __init__(self, path: str | Path | None = None) -> None:
        explicit: str | None = str(path) if path is not None else None
        if explicit is None:
            explicit = os.environ.get(DOTENV_PATH_VAR, "").strip() or None
        self._explicit = explicit is not None
        self._path = Path(explicit) if explicit is not None else _DEFAULT_DOTENV_PATH
        self._values = self._parse()

    def fetch(self) -> dict[str, str]:
        return dict(self._values)

    def get(self, key: str, default: str | None = None) -> str | None:
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
