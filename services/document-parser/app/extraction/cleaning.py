"""The phase-2 normalizer (cleaning.md): one shared, ordered,
string-in/string-out pass over the strategies' raw lines — owned by the
pipeline, never run inside a strategy.
"""

from collections.abc import Sequence


def normalize(lines: Sequence[str]) -> str:
    """The ordered phase-2 rules for raw ordered lines (cleaning.md)."""
    raise NotImplementedError("the phase-2 normalizer is not built yet")
