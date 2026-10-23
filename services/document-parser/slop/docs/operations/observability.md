# Observability

This document explains how to monitor the Document Parser service and understand its behavior.

## What is Observability?

Observability means being able to understand what's happening inside a system by looking at its outputs. For the Document Parser service, this includes:

- **Logs** - Written records of what happened
- **Metrics** - Numbers that measure performance
- **Traces** - Distributed tracing across services (via OpenTelemetry)

## Logs

Logs are written to standard output in JSON format. They're useful for debugging specific issues. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, the same logs are also forwarded to the collector over OTLP/HTTP (`/v1/logs`) -- this is fail-open, so if the collector is down or no endpoint is set, the service keeps running and you still get stdout logs.

### What Gets Logged

| Component | What It Logs |
|-----------|--------------|
| Middleware | Request method, path, status code, duration, trace and span IDs |
| Extraction | MIME type, duration, success/error, truncated |
| Validation | Rejection reasons (too large, unsupported type) |
| Pool | Queue depth, active threads |
| Config | Loaded configuration at startup |

Health, readiness, and metrics probes (`/api/v1/health`, `/api/v1/ready`, `/api/v1/metrics`) are logged at `DEBUG` so they don't drown out real traffic. Everything else is logged at `INFO`. Each log line also carries `service.name` and `deployment.environment` so you can tell dev, prod, and loadtest traffic apart.

Request fields are written twice on purpose: once inside `request_meta` (nice for reading stdout and for tests) and once as flat top-level fields (the OTLP log exporter drops nested objects, so flat fields keep them searchable in your log backend).

### Example Log Entry

```json
{
  "timestamp": "2024-09-10T12:00:00Z",
  "level": "INFO",
  "severity": "INFO",
  "message": "Request processed",
  "module": "middleware",
  "logger": "file_service",
  "service.name": "document-parser",
  "deployment.environment": "dev",
  "method": "POST",
  "path": "/api/v1/extract",
  "status_code": 200,
  "duration_ms": 234.56,
  "trace_id": "abc123def456",
  "span_id": "0123456789abcdef"
}
```

### Log Levels

| Level | When to Use |
|-------|-------------|
| `DEBUG` | Detailed information for debugging (health and readiness probes live here) |
| `INFO` | Normal operations |
| `WARNING` | Something unexpected but not critical |
| `ERROR` | Something failed |
| `CRITICAL` | Service cannot continue |

## Traces

Traces show how a single request flows through the service. They are off by default -- set `OTEL_EXPORTER_OTLP_ENDPOINT` to an `http(s)://` collector URL to turn them on. The service uses `FastAPIInstrumentor` for HTTP spans plus one `extraction` span per document.

### What Each Extraction Span Carries

| Attribute | Example | What It Tells You |
|-----------|---------|-------------------|
| `mime.type` | `application/pdf` | File type (OpenTelemetry naming) |
| `file.size_bytes` | `783921` | How big the upload was |
| `text.length_bytes` | `41203` | How much clean text came out |
| `truncated` | `false` | Whether output hit `MAX_TEXT_LENGTH` |

Older names (`mime_type`, `file_size`, `text_length`) are still set alongside the new dotted names so existing dashboards keep working. If extraction throws, the span records the exception and is marked as an error, so failed extractions stand out in your trace backend.

### Resource Attributes

Every span and log carries `service.name`, `service.version`, and `deployment.environment`. The last one is how you separate environments in New Relic: filter on `deployment.environment = prod` vs `loadtest` vs `dev`.

Precedence for the endpoint: explicit argument > `OTEL_EXPORTER_OTLP_ENDPOINT` env > `Settings`. Precedence for `deployment.environment`: `OTEL_RESOURCE_ATTRIBUTES` (for example `deployment.environment=loadtest`) > `DEPLOYMENT_ENV` > `ENV_TYPE` > built-in default. Extra `OTEL_RESOURCE_ATTRIBUTES` pairs are merged in untouched.

## Metrics

Metrics are exposed at:

- **API**: `http://localhost:8000/api/v1/metrics`

### HTTP Metrics

| Metric | Type | Labels | What It Tells You |
|--------|------|--------|-------------------|
| `http_requests_total` | Counter | `method, route, status_code` | Total requests |
| `http_request_errors_total` | Counter | `method, route, status_code` | Requests with status >= 400 |
| `http_request_duration_seconds` | Histogram | `method, route, status_code` | Request latency |
| `in_flight_requests` | Gauge | - | Currently processing requests |

### Extraction Metrics

| Metric | Type | Labels | What It Tells You |
|--------|------|--------|-------------------|
| `parsed_documents_total` | Counter | `mime_type, status` | Total extractions (success/error) |
| `parsed_file_size_bytes` | Histogram | `mime_type` | Uploaded file sizes |
| `extracted_text_bytes_total` | Counter | `mime_type` | Volume of extracted text |
| `extracted_text_length_bytes` | Histogram | `mime_type` | Distribution of text lengths |
| `extraction_compression_ratio` | Histogram | `mime_type` | File size / text size ratio |
| `extraction_duration_seconds` | Histogram | `mime_type, status` | How long extraction takes |
| `extraction_queue_wait_seconds` | Histogram | `mime_type` | Time waiting in thread pool |
| `extraction_failures_total` | Counter | `mime_type, error_type` | Failures by type |
| `extraction_timeouts_total` | Counter | `mime_type` | Timeout count |

### Rejection Metrics

| Metric | Type | Labels | What It Tells You |
|--------|------|--------|-------------------|
| `rejected_uploads_total` | Counter | `reason` | Rejections (too_large, unsupported_type) |

### Pool Metrics

| Metric | Type | What It Tells You |
|--------|------|-------------------|
| `extraction_pool_active_threads` | Gauge | Currently busy threads |
| `extraction_pool_queue_depth` | Gauge | Tasks waiting in queue |
| `extraction_pool_max_workers` | Gauge | Maximum thread pool size |

### Error Classification

Failures are classified into these error types via `_ERROR_TYPE_MAP`:

| Error Type | Exception | Meaning |
|------------|-----------|---------|
| `file_too_large` | `FileTooLargeError` | Upload exceeds 10 MiB |
| `document_too_large` | `DocumentTooLargeError` | PDF pages > 1000 or DOCX uncompressed > 100 MB |
| `unsupported_file_type` | `UnsupportedFileTypeError` | MIME not in allowed list |
| `timeout` | `ExtractionTimeoutError` | Extraction exceeded timeout |
| `corrupt_document` | `ExtractionError` | File is unreadable or damaged |
| `unexpected` | (any other) | Unexpected error |

Rejections are classified via `_REJECTED_REASON_MAP`:

| Reason | Exceptions |
|--------|-----------|
| `too_large` | `FileTooLargeError`, `DocumentTooLargeError` |
| `unsupported_type` | `UnsupportedFileTypeError` |

### Viewing Metrics

```bash
# View all metrics
curl http://localhost:8000/api/v1/metrics

# View specific metric
curl -s http://localhost:8000/api/v1/metrics | grep extraction_duration
```

## Dashboards and Alerts

### Built-in Alerts

| Alert | Condition | For | What It Means |
|-------|-----------|-----|---------------|
| Parser down | `up{job="document-parser"} == 0` | 2m | Service is not running |
| High error rate | `rate(http_requests_total{status_code=~"4..|5.."}[5m]) > 0.05` | 10m | More than 5% of requests are errors |
| High latency | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2s` | 10m | 95th percentile latency above 2 seconds |
| Extraction failures | `rate(parsed_documents_total{status="error"}[5m]) > 0.1` | 10m | More than 0.1 failures per second |
| High rejection rate | `rate(rejected_uploads_total[5m]) > 1` | 15m | More than 1 rejection per second |
| Pool saturation | `extraction_pool_queue_depth > 10` | 10m | Thread pool queue is growing |

### Load-Test Observability (Opt-in)

Normal load runs are fully offline -- no collector, no network calls. When you want traces, metrics, and logs in New Relic, add `WITH_OBSERVABILITY=1`:

```bash
export NEW_RELIC_LICENSE_KEY="..."   # ingest key, never commit it
make load-test SCENARIO=load WITH_OBSERVABILITY=1 VUS=20 DURATION=2m
```

What that flag does: it starts `otel-collector-loadtest` alongside the service on the same `loadnet` network (see `infra/compose.load.observability.yml` + shared atom `infra/docker/otel/`). The collector scrapes `document-parser:8000/api/v1/metrics` every 15s, gathers host CPU and memory plus per-container CPU, memory, network, and throttling stats via the Docker socket, and exports everything to New Relic EU over `https://otlp.eu01.nr-data.net:443`. Keep port `443` -- port `4318` is blocked on this egress path.

Two details that keep dashboards clean:

- Telemetry is labeled `deployment.environment=loadtest` while `ENV_TYPE` stays `dev`, so app behavior is unchanged but k6 traffic never pollutes prod boards. Look for the `detectai-document-parser (loadtest)` dashboard.
- The collector drops noisy but healthy spans (`/health`, `/ready`, `/metrics` with OK status) to control cost. Failed spans -- for example `503` from `/ready` when the pool is saturated -- are kept, so the "readiness 503s" panel still lights up during stress and soak runs.

Give infra panels a few minutes to fill: parser scrapes and container stats tick every 15s, so short smoke runs mostly populate span and log panels. Memory-percentage panels rely on the `mem_limit` values in the overlay (parser 2g, k6 1g, collector 512m). If `NEW_RELIC_LICENSE_KEY` is empty, the collector retries and drops while the apps keep running -- fail-open by design.

## Monitoring Checklist

### Daily

- [ ] Check service health status
- [ ] Review error logs
- [ ] Monitor extraction failure rate

### Weekly

- [ ] Review performance trends (latency, throughput)
- [ ] Check pool saturation patterns
- [ ] Validate alert thresholds

### Monthly

- [ ] Review capacity and scaling needs
- [ ] Update alert thresholds if needed
- [ ] Review and clean up old logs

## Troubleshooting with Observability

### Slow Response Times

1. Check `http_request_duration_seconds` - Are requests taking too long?
2. Check `extraction_duration_seconds` - Is extraction slow?
3. Check `extraction_pool_queue_depth` - Is the pool saturated?
4. Check `extraction_queue_wait_seconds` - Are tasks waiting too long?

### High Rejection Rate

1. Check `rejected_uploads_total{reason="too_large"}` - Clients sending large files?
2. Check `rejected_uploads_total{reason="unsupported_type"}` - Wrong file formats?
3. Review client code for format validation

### Pool Saturation

1. Check `extraction_pool_active_threads` vs `extraction_pool_max_workers`
2. Check `extraction_pool_queue_depth` - How many tasks are waiting?
3. Consider increasing `WORKER_THREADS` if saturation is frequent

### Extraction Failures

1. Check `extraction_failures_total{error_type="timeout"}` - Files too complex?
2. Check `extraction_failures_total{error_type="corrupt_document"}` - Bad input files?
3. Check `extraction_failures_total{error_type="document_too_large"}` - Oversized documents?

## Related Documentation

- [Health Checks](../components/health.md) - Health check details
- [Configuration](../getting-started/configuration.md) - Monitoring settings
- [Architecture](../concepts/architecture.md) - How components connect
