"""The OTLP wire shaping, in one pure place — the only file a backend swap touches.

The per-signal URL joins and the header scheme are the flat facts the
factory feeds every exporter: New Relic's native OTLP endpoint authenticates
with the ingest license key in the api-key header (not the SDK's default
authorization header), and the endpoint is region-prefixed
(otlp.nr-data.net; EU accounts otlp.eu01.nr-data.net). gzip and delta
temporality ride the adapters' exporters, not here — this module stays pure
so a backend swap edits one file and one settings value.
"""

from __future__ import annotations

_TRACES_PATH = "/v1/traces"
_METRICS_PATH = "/v1/metrics"
_LOGS_PATH = "/v1/logs"


def _url(endpoint: str, signal_path: str) -> str:
    return f"{endpoint.rstrip('/')}{signal_path}"


def traces_url(endpoint: str) -> str:
    """The endpoint joined to /v1/traces."""
    return _url(endpoint, _TRACES_PATH)


def metrics_url(endpoint: str) -> str:
    """The endpoint joined to /v1/metrics."""
    return _url(endpoint, _METRICS_PATH)


def logs_url(endpoint: str) -> str:
    """The endpoint joined to /v1/logs."""
    return _url(endpoint, _LOGS_PATH)


def headers(license_key: str) -> dict[str, str]:
    """The api-key header carrying the ingest license key — never a user
    API key, and the SDK's default authorization header is deliberately not
    set (New Relic's OTLP shape, observability.md)."""
    return {"api-key": license_key}
