"""Core-level constants — no domain imports."""

from __future__ import annotations

import re

VERSION_PATTERN = re.compile(r"^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")

MODEL_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-_]{1,63}$")

DEFAULT_DESCRIPTION_TEMPLATE = "Production release {version}"

EXIT_CODE_USAGE = 2
EXIT_CODE_RUNTIME = 1
