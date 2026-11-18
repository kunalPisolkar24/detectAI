"""Production-boot fixtures for the integration suite.

The pins go in before any boot spins up: ENV_TYPE=dev pins the flick and
the pinned API_KEY wins the dev merge over whatever infra/.env carries —
the config boot is deterministic regardless of the host plane.
"""

from collections.abc import Iterator

import pytest

KEY = "integration-test-key-001"


@pytest.fixture(autouse=True)
def _boot_env() -> Iterator[None]:
    patch = pytest.MonkeyPatch()
    patch.setenv("ENV_TYPE", "dev")
    patch.setenv("API_KEY", KEY)
    # the integration tier boots the disabled observability shape: a blank
    # endpoint normalizes to unset, so no host OTLP endpoint leaks in
    patch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    yield
    patch.undo()
