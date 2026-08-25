import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_health_returns_ok_when_pool_is_alive(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_returns_503_when_pool_is_shutdown(client, mocker):
    mocker.patch("app.api.v1.endpoints.health.is_process_pool_healthy", return_value=False)

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


def test_ready_returns_ready_when_pool_is_alive(client):
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_ready_returns_503_when_pool_is_shutdown(client, mocker):
    mocker.patch("app.api.v1.endpoints.health.is_process_pool_healthy", return_value=False)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


def test_ready_returns_503_when_all_workers_busy(client, mocker):
    mocker.patch("app.api.v1.endpoints.health.get_pool_stats", return_value=(4, 0, 4))

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


def test_ready_returns_503_when_queue_depth_exceeded(client, mocker):
    mocker.patch("app.api.v1.endpoints.health.get_pool_stats", return_value=(1, 60, 4))

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


def test_ready_returns_ok_under_partial_load(client, mocker):
    mocker.patch("app.api.v1.endpoints.health.get_pool_stats", return_value=(2, 5, 4))

    response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
