# Observability

This document explains how to monitor the Document Parser service and understand its behavior.

## What is Observability?

Observability means being able to understand what's happening inside a system by looking at its outputs. For the Document Parser service, this includes:

- **Logs** - Written records of what happened
- **Metrics** - Numbers that measure performance
- **Traces** - Distributed tracing across services

## Logs

Logs are written to standard output in JSON format. They're useful for debugging specific issues.

### What Gets Logged

| Component | What It Logs |
|-----------|--------------|
| Middleware | Request method, path, status code, duration |
| Extraction | MIME type, duration, success/error, truncated |
| Validation | Rejection reasons (too large, unsupported type) |
| Pool | Queue depth, active threads |

### Example Log Entry

```json
{
  "level": "info",
  "msg": "request completed",
  "method": "POST",
  "path": "/api/v1/extract",
  "status_code": 200,
  "duration_ms": 234,
  "trace_id": "abc123"
}
```

### Log Levels

| Level | When to Use |
|-------|-------------|
| `DEBUG` | Detailed information for debugging |
| `INFO` | Normal operations |
| `WARNING` | Something unexpected but not critical |
| `ERROR` | Something failed |
| `CRITICAL` | Service cannot continue |

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

Failures are classified into these error types:

| Error Type | Meaning |
|------------|---------|
| `file_too_large` | Upload exceeds 10 MiB |
| `document_too_large` | PDF pages > 1000 or DOCX uncompressed > 100 MB |
| `unsupported_file_type` | MIME not in allowed list |
| `timeout` | Extraction exceeded timeout |
| `corrupt_document` | File is unreadable or damaged |
| `unexpected` | Unexpected error |

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
