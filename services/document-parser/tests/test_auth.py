"""x-api-key guard: one carrier, one constant-time compare, one 401 shape.

HTTP cases run through a test-assembled route that carries the dependency
exactly as the extract route will; the probes on the production app are
checked statically to prove they stay open (FR-6).
"""

import logging

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.api.auth import _REJECT_DETAIL, api_key_auth, credential_matches
from app.config import Settings

_KEY = "bootstrap-test-key-00001"


def _build_app() -> FastAPI:
    app = FastAPI()
    app.state.settings = Settings(api_key=_KEY)

    @app.get("/guarded", dependencies=[Depends(api_key_auth)])
    def guarded() -> dict[str, str]:
        return {"status": "passed"}

    return app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_app())


def test_missing_header_is_rejected_with_the_generic_body(client: TestClient) -> None:
    response = client.get("/guarded")

    assert response.status_code == 401
    assert response.json() == {"detail": _REJECT_DETAIL}


def test_wrong_key_is_rejected(client: TestClient) -> None:
    response = client.get("/guarded", headers={"x-api-key": "wrong-key-wrong-key"})

    assert response.status_code == 401
    assert response.json() == {"detail": _REJECT_DETAIL}


def test_missing_and_invalid_bodies_are_byte_identical(client: TestClient) -> None:
    missing = client.get("/guarded")
    invalid = client.get("/guarded", headers={"x-api-key": "wrong-key-wrong-key"})

    assert missing.content == invalid.content


def test_empty_and_whitespace_candidates_are_rejected(client: TestClient) -> None:
    assert client.get("/guarded", headers={"x-api-key": ""}).status_code == 401
    assert client.get("/guarded", headers={"x-api-key": "   "}).status_code == 401


def test_valid_key_passes(client: TestClient) -> None:
    response = client.get("/guarded", headers={"x-api-key": _KEY})

    assert response.status_code == 200
    assert response.json() == {"status": "passed"}


def test_rejection_is_logged_without_echoing_the_candidate(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    attempted = "must-never-appear-12345"

    with caplog.at_level(logging.WARNING, logger="app.api.auth"):
        client.get("/guarded", headers={"x-api-key": attempted})

    assert any("invalid key" in record.getMessage() for record in caplog.records)
    assert attempted not in "\n".join(record.getMessage() for record in caplog.records)


def test_credential_matches_shapes() -> None:
    assert credential_matches(_KEY, _KEY) is True
    assert credential_matches(_KEY, None) is False
    assert credential_matches(_KEY, "\ud800") is False  # lone surrogate degrades to a mismatch
    assert credential_matches(_KEY, _KEY + "x") is False


def test_production_probe_routes_stay_open() -> None:
    from app.main import app as production_app

    for route in production_app.routes:
        if getattr(route, "path", None) in {"/api/v1/health", "/api/v1/ready"}:
            assert not route.dependencies
