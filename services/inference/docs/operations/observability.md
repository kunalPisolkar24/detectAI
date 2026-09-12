# Observability

This document explains how to monitor the Inference service and understand its behavior.

## What is Observability?

Observability means being able to understand what's happening inside a system by looking at its outputs. For the Inference service, this includes:

- **Logs** - Written records of what happened
- **Metrics** - Numbers that measure performance
- **Traces** - Requests tracked across the system
- **Alerts** - Notifications when something goes wrong

## Logs

Logs are written to standard output in JSON format. They're useful for debugging specific issues.

### What Gets Logged

| Component | What It Logs |
|-----------|--------------|
| API | Request handling, errors |
| Auth | Authentication attempts, failures |
| Batching | Batch processing, queue status |
| Health | Health state changes |
| Models | Model loading, provider fallback |

### Example Log Entry

```json
{
  "level": "info",
  "msg": "health_state_changed",
  "state": "SERVING",
  "timestamp": "2024-09-10T12:00:00Z"
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

Metrics are numbers that help you understand performance. They're exposed at:

- **Metrics**: `http://localhost:8333/metrics`

### Key Metrics

#### gRPC Requests

| Metric | What It Tells You |
|--------|-------------------|
| `grpc_requests_total` | How many requests were made |
| `grpc_latency_seconds` | How long requests take |
| `grpc_auth_failures_total` | How many auth failures |

#### Batching

| Metric | What It Tells You |
|--------|-------------------|
| `model_batch_size` | Distribution of batch sizes |
| `model_batch_queue_size` | Items waiting in queue |
| `model_batch_queue_wait_seconds` | Time items wait in queue |
| `model_batch_processing_seconds` | Time to process batches |

#### Document Analysis

| Metric | What It Tells You |
|--------|-------------------|
| `inference_document_input_chars` | Input document sizes |
| `inference_document_chunk_count` | Number of chunks per request |
| `inference_document_inflight_chunks` | Currently processing chunks |
| `inference_document_chunks_processed_total` | Successfully processed chunks |
| `inference_document_chunks_failed_total` | Failed chunks |

#### Health

| Metric | What It Tells You |
|--------|-------------------|
| `inference_service_health_status` | Overall service health |
| `inference_service_health_reason` | Why service is unhealthy |
| `inference_engine_health_status` | Per-model health |
| `inference_engine_queue_capacity` | Configured queue size |

#### Reliability

| Metric | What It Tells You |
|--------|-------------------|
| `inference_batch_queue_rejected_total` | Rejected predictions |
| `inference_batch_errors_total` | Batch processing errors |
| `inference_engine_provider_fallback_total` | Provider fallbacks (GPU→CPU) |

### Viewing Metrics

```bash
# View all metrics
curl http://localhost:8333/metrics

# View specific metric
curl http://localhost:8333/metrics | grep grpc_requests_total
```

## Tracing

Tracing tracks requests across the system using OpenTelemetry.

### Setup

Tracing is enabled when `OTEL_EXPORTER_OTLP_ENDPOINT` is set:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=inference
```

### What Gets Traced

- gRPC requests (Detect, AnalyzeDocument)
- Model inference time
- Chunk processing time

### Disabling Tracing

If `OTEL_EXPORTER_OTLP_ENDPOINT` is empty, tracing is disabled (fail-open).

## Dashboards

The service exposes metrics for Grafana dashboards:

| Dashboard | What It Shows |
|-----------|---------------|
| `04-inference-overview.json` | API performance and health |

### Setting Up Dashboards

1. Import the JSON files into Grafana
2. Configure Prometheus as the data source
3. Point to `ai-service:8333`

## Alerts

Alerts notify you when something needs attention.

### Built-in Alerts

| Alert | Condition | What It Means |
|-------|-----------|---------------|
| **Inference down** | Service not responding for 2 minutes | Service is down |
| **High error rate** | Error rate above 5% for 5 minutes | Something is broken |
| **High latency** | Requests taking too long for 10 minutes | Performance issue |
| **Queue full** | Engine queue full for more than 1 minute | Service overloaded |
| **Batch timeouts** | Too many batch errors for 5 minutes | Model issues |
| **Provider fallback** | Any GPU→CPU fallback | GPU unavailable |

### Alert Rules

```yaml
# Example Prometheus alert rule
groups:
  - name: inference
    rules:
      - alert: InferenceDown
        expr: up{job="inference"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Inference service is down"
      
      - alert: HighErrorRate
        expr: rate(grpc_requests_total{code!="OK"}[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate on inference service"
      
      - alert: QueueFull
        expr: inference_engine_health_status{status="queue_full"} == 1
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Inference queue is full"
```

## Monitoring Checklist

### Daily

- [ ] Check service health status
- [ ] Review error logs
- [ ] Monitor queue size

### Weekly

- [ ] Review performance trends
- [ ] Check batch processing times
- [ ] Validate alert thresholds

### Monthly

- [ ] Review capacity and scaling needs
- [ ] Update alert thresholds if needed
- [ ] Review and clean up old logs

## Troubleshooting with Observability

### Slow Response Times

1. Check `grpc_latency_seconds` - Are requests taking too long?
2. Check `model_batch_queue_wait_seconds` - Items waiting too long?
3. Check `model_batch_processing_seconds` - Batches taking too long?

### Predictions Failing

1. Check `inference_batch_queue_rejected_total` - Queue problems?
2. Check `inference_batch_errors_total` - Batch processing problems?
3. Check `inference_document_chunks_failed_total` - Chunk failures?

### High Memory Usage

1. Check `model_batch_queue_size` - Too many items waiting?
2. Check `BATCH_SIZE` - Processing too many at once?
3. Check `BATCH_QUEUE_MAX_SIZE` - Queue too large?

### Provider Fallback Active

1. Check `inference_engine_provider_fallback_total` - GPU→CPU fallbacks?
2. Verify GPU is available: `nvidia-smi`
3. Check Docker GPU access: `docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi`

## Related Documentation

- [Health](../components/health.md) - Health check details
- [Configuration](../getting-started/configuration.md) - Monitoring settings
- [Batching](../concepts/batching.md) - How batching affects metrics
