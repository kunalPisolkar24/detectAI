import pytest

pytestmark = pytest.mark.integration
def test_ready_reports_ready_under_healthy_pool(client):
    response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_ready_reports_not_ready_when_pool_unavailable(client, pool_unavailable):
    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


def test_metrics_endpoint_exposes_core_families(client):
    response = client.get("/metrics")

    assert response.status_code == 200
    for family in (b"in_flight_requests", b"parsed_documents_total", b"extraction_duration_seconds"):
        assert family in response.content
