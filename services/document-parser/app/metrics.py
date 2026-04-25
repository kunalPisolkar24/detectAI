import os
from prometheus_client import CONTENT_TYPE_LATEST, REGISTRY, CollectorRegistry, Counter, Histogram, generate_latest, multiprocess

HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total number of HTTP requests",
    ["method", "route", "status_code"],
)

HTTP_REQUEST_ERRORS_TOTAL = Counter(
    "http_request_errors_total",
    "Total number of HTTP requests resulting in errors",
    ["method", "route", "status_code"],
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "http_request_duration_seconds",
    "Duration of HTTP requests in seconds",
    ["method", "route", "status_code"],
    buckets=(0.01, 0.05, 0.1, 0.3, 0.5, 1.0, 2.5, 5.0, 10.0),
)

def record_request(method: str, route: str, status_code: int, duration: float) -> None:
    status_code_label = str(status_code)
    HTTP_REQUESTS_TOTAL.labels(method=method, route=route, status_code=status_code_label).inc()
    HTTP_REQUEST_DURATION_SECONDS.labels(method=method, route=route, status_code=status_code_label).observe(duration)
    if status_code >= 400:
        HTTP_REQUEST_ERRORS_TOTAL.labels(method=method, route=route, status_code=status_code_label).inc()

def render_metrics() -> tuple[bytes, str]:
    registry = REGISTRY
    if os.getenv("PROMETHEUS_MULTIPROC_DIR"):
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
    return generate_latest(registry), CONTENT_TYPE_LATEST
