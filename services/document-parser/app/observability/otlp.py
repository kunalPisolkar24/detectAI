"""New Relic's OTLP shaping: region-prefixed endpoints, api-key auth, pure on purpose."""

from __future__ import annotations

_TRACES_PATH = "/v1/traces"
_METRICS_PATH = "/v1/metrics"
_LOGS_PATH = "/v1/logs"


def _url(endpoint: str, signal_path: str) -> str:
    return f"{endpoint.rstrip('/')}{signal_path}"


def traces_url(endpoint: str) -> str:
    return _url(endpoint, _TRACES_PATH)


def metrics_url(endpoint: str) -> str:
    return _url(endpoint, _METRICS_PATH)


def logs_url(endpoint: str) -> str:
    return _url(endpoint, _LOGS_PATH)


def headers(license_key: str) -> dict[str, str]:
    """api-key auth — the SDK's default authorization header is off on purpose."""
    return {"api-key": license_key}
