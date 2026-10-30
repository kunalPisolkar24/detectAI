"""The OTLP wire shaping: URLs per signal and the New Relic header scheme."""

from app.observability.otlp import headers, logs_url, metrics_url, traces_url


def test_urls_join_the_endpoint_to_its_signal_path() -> None:
    assert traces_url("https://otlp.nr-data.net") == "https://otlp.nr-data.net/v1/traces"
    assert metrics_url("https://otlp.nr-data.net") == "https://otlp.nr-data.net/v1/metrics"
    assert logs_url("https://otlp.nr-data.net") == "https://otlp.nr-data.net/v1/logs"


def test_a_trailing_slash_on_the_endpoint_is_tolerated() -> None:
    assert traces_url("http://localhost:4318/") == "http://localhost:4318/v1/traces"


def test_the_ingest_key_rides_the_api_key_header() -> None:
    assert headers("license-1") == {"api-key": "license-1"}
