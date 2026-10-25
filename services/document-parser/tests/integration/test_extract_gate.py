"""The x-api-key gate, end to end, through the production app.

Every case runs against app.main's real extract route and probes: real
lifespan config boot, real routing, real guard. The unit suite pins the
comparison semantics; this suite pins what a caller actually gets.
"""

import logging

import pytest
from fastapi.testclient import TestClient

from .conftest import KEY, _assert_env_holds


def test_missing_header_is_rejected_with_the_generic_body(client: TestClient) -> None:
    response = client.post("/api/v1/extract")

    assert response.status_code == 401
    assert response.json() == {"detail": "invalid or missing API key"}


def test_wrong_key_is_rejected(client: TestClient) -> None:
    response = client.post("/api/v1/extract", headers={"x-api-key": "wrong-key-wrong-key"})

    assert response.status_code == 401
    assert response.json() == {"detail": "invalid or missing API key"}


def test_missing_and_invalid_bodies_are_byte_identical(client: TestClient) -> None:
    missing = client.post("/api/v1/extract")
    invalid = client.post("/api/v1/extract", headers={"x-api-key": "wrong-key-wrong-key"})

    assert missing.content == invalid.content


def test_empty_and_whitespace_candidates_are_rejected(client: TestClient) -> None:
    assert client.post("/api/v1/extract", headers={"x-api-key": ""}).status_code == 401
    assert client.post("/api/v1/extract", headers={"x-api-key": "   "}).status_code == 401


def test_bearer_is_not_a_carrier_even_for_the_correct_key(client: TestClient) -> None:
    response = client.post("/api/v1/extract", headers={"Authorization": f"Bearer {KEY}"})

    assert response.status_code == 401
    assert response.json() == {"detail": "invalid or missing API key"}


def test_rejection_is_logged_without_echoing_the_candidate(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    attempted = "must-never-echo-12345"

    with caplog.at_level(logging.WARNING):
        client.post("/api/v1/extract", headers={"x-api-key": attempted})

    rejection_logs = [
        record.getMessage() for record in caplog.records if "authentication rejected" in record.getMessage()
    ]
    assert rejection_logs
    assert all("invalid key" in message for message in rejection_logs)
    assert attempted not in "\n".join(rejection_logs)


def test_probe_routes_stay_open_through_the_live_app(client: TestClient) -> None:
    unauthenticated = client.get("/api/v1/health")
    bogus_key = client.get("/api/v1/ready", headers={"x-api-key": "wrong-key-wrong-key"})

    assert unauthenticated.status_code == 200
    assert unauthenticated.json() == {"status": "ok"}
    assert bogus_key.status_code == 200
    assert bogus_key.json() == {"status": "ready"}
    _assert_env_holds()
