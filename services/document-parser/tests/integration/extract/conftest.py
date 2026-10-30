"""Production-app fixtures for the integration suite.

The module-scoped client runs the real lifespan, so the env pin must be in
place before it spins up: patching live here (not per test) is what makes
the config boot deterministic — ENV_TYPE=dev pins the flick and the
pinned API_KEY wins the dev merge over whatever infra/.env carries.
"""

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

KEY = "integration-test-key-001"


@pytest.fixture(scope="module", autouse=True)
def _boot_env() -> Iterator[None]:
    patch = pytest.MonkeyPatch()
    patch.setenv("ENV_TYPE", "dev")
    patch.setenv("API_KEY", KEY)
    # the extract matrix tests the disabled observability boot: the dev host's
    # infra/.env carries an OTLP endpoint, and the pin keeps these boots on
    # the null object exactly as a fileless container without the endpoint
    patch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    yield
    patch.undo()


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    from app.main import app as production_app

    with TestClient(production_app) as test_client:
        yield test_client


def _assert_env_holds() -> None:
    assert os.environ.get("ENV_TYPE") == "dev"  # a stray host export must not flip the flick
