def test_metrics_route_renders_prometheus_payload(client):
    response = client.get("/metrics")

    assert response.status_code == 200
    assert b"http_requests_total" in response.content


def test_ready_returns_503_when_pool_stats_missing(client, mocker):
    mocker.patch("app.api.v1.endpoints.health.is_process_pool_healthy", return_value=True)
    mocker.patch("app.api.v1.endpoints.health.get_pool_stats", return_value=None)

    response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}
