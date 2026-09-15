"""Domain constants — version and model-key rules."""

from __future__ import annotations

import re

VERSION_PATTERN = re.compile(r"^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
MODEL_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-_]{1,63}$")

SUPPORTED_MODEL_KEYS = frozenset({"detect-ai-spark", "detect-ai-flare"})
