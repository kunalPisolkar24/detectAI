# Configuration

This document explains how to configure the Inference service for `ENV_TYPE=dev` (local compose) and `ENV_TYPE=prod` (AWS).

## How Configuration Works

The service uses two configuration modes:

- **Dev mode** (`ENV_TYPE=dev`) - Loads settings from `.env` file or environment variables. No AWS calls. Validation is local only.
- **Prod mode** (`ENV_TYPE=prod`) - Loads secrets from AWS Secrets Manager and parameters from SSM Parameter Store. Strict validation rejects dev fallback values.

**Precedence**: `process env` > `AWS (cfg)` > `prod non-secret overrides` > `Settings` defaults.

## Required Configuration

```bash
ENV_TYPE=dev                    # or 'prod'
API_KEY=dev-secret-key-16chars-at-least   # >=16 chars
```

| Setting | What It Does | Example |
|---------|--------------|---------|
| `ENV_TYPE` | Switch between dev and prod | `dev` or `prod` |
| `API_KEY` | HMAC/JWT secret for authentication | `dev-secret-key-16chars-at-least` |

In **prod mode**, `API_KEY` must come from AWS Secrets Manager (`detectai/inference/secrets`). The service will fail to start if it detects a dev fallback value.

## Optional Configuration

### Network

```bash
GRPC_PORT=50051                 # default 50051
GRPC_MAX_WORKERS=50             # max concurrent RPCs (1..500)
METRICS_PORT=8333               # Prometheus metrics
```

### Model Settings

```bash
MODEL_CACHE_DIR=./models        # where models are cached
HF_TOKEN=                       # optional HuggingFace token for private repos
SPARK_MODEL_REVISION=9a48004391c71272d6fb1d164ed7c56e1fbfe360
FLARE_MODEL_REVISION=e1911c0be59f4e10f0d120f639d1358e46bc2086
```

### Batching & Concurrency

```bash
BATCH_SIZE=32                   # items per batch (1..512)
BATCH_TIMEOUT=0.05              # batch linger time in seconds (0..10)
BATCH_QUEUE_MAX_SIZE=1024       # max queue size (1..10000)
INFERENCE_MAX_WORKERS=32        # thread pool size (1..128)
MAX_CONCURRENT_BATCHES=4        # concurrent ONNX runs (1..32)
MAX_INFLIGHT_DOC_CHUNKS=8       # concurrent chunks per request (1..64)
```

### Text Processing

```bash
MAX_TEXT_CHARS=50000             # max input characters (1..200000)
MAX_GLOBAL_TOKENS=10000          # max tokens per request (1..100000)
CHUNK_TOKEN_LIMIT=256            # tokens per chunk (1..2048)
CHUNK_TOKEN_STRIDE=192           # overlap between chunks (1..2048)
```

### Inference Providers

```bash
INFERENCE_PROVIDERS=CPUExecutionProvider    # comma-separated or JSON array
```

Allowed values:
- `CPUExecutionProvider` - CPU inference (default)
- `CUDAExecutionProvider` - NVIDIA GPU
- `TensorrtExecutionProvider` - TensorRT optimization
- `ROCMExecutionProvider` - AMD GPU
- `OpenVINOExecutionProvider` - Intel optimization

### Observability

```bash
LOG_LEVEL=INFO                   # DEBUG/INFO/WARNING/ERROR/CRITICAL
OTEL_EXPORTER_OTLP_ENDPOINT=     # empty disables tracing
OTEL_SERVICE_NAME=inference
OTEL_SERVICE_VERSION=0.1.0
```

### AWS (prod only)

```bash
AWS_REGION=ap-south-1
AWS_ENDPOINT_URL=                # LocalStack/Floci override
SSM_PREFIX=/detectai/inference/
SSM_ENABLED=true                 # false disables SSM
INFERENCE_SECRETS_NAME=detectai/inference/secrets
```

## Environment Examples

### Local Development (ENV_TYPE=dev)

```bash
ENV_TYPE=dev
API_KEY=dev-secret-key-16chars-at-least
INFERENCE_PROVIDERS=CPUExecutionProvider
LOG_LEVEL=DEBUG
```

With `.env` file, `ENV_TYPE=dev` auto-loads it. The service starts without any AWS calls.

### Docker Compose (dev)

```bash
# Start with defaults
make inference-up

# Start with GPU
make inference-up GPU=1
```

The compose file passes canonical vars with same-name defaults.

### Production (AWS)

```bash
ENV_TYPE=prod
AWS_REGION=ap-south-1
# API_KEY comes from detectai/inference/secrets (AWS Secrets Manager)
# Other settings come from SSM /detectai/inference/*
```

Floci local prod test:
```bash
ENV_TYPE=prod AWS_REGION=ap-south-1 AWS_ENDPOINT_URL=http://host.docker.internal:4566 \
  docker compose -f infra/compose.yml up
```

## Configuration Validation

The service validates all settings at startup:

| Error | Cause | Fix |
|-------|-------|-----|
| `ENV_TYPE must be dev or prod` | Invalid env type | Set `ENV_TYPE=dev` or `prod` |
| `API_KEY must be at least 16 characters` | Short API key | Use a longer key |
| `CHUNK_TOKEN_STRIDE must be less than or equal to CHUNK_TOKEN_LIMIT` | Stride > limit | Reduce stride or increase limit |
| `MAX_GLOBAL_TOKENS must be >= CHUNK_TOKEN_LIMIT` | Global < chunk | Increase global or reduce chunk |
| `BATCH_QUEUE_MAX_SIZE must be >= BATCH_SIZE` | Queue < batch | Increase queue or reduce batch |
| `INFERENCE_MAX_WORKERS must be >= MAX_CONCURRENT_BATCHES` | Workers < batches | Increase workers or reduce batches |
| `Unknown INFERENCE_PROVIDERS` | Invalid provider | Use allowed provider names |
| `Model revisions must be full 40-character lowercase git SHAs` | Bad revision | Use valid commit SHA |

Failed validation causes the service to exit at startup.

## Viewing Current Configuration

The service logs configuration at startup:

```
metrics_server_started port=8333
loading_models
```

Metrics: `http://localhost:8333/metrics`

## Developer Workflow

The service includes a Makefile with common commands:

| Command | What It Does |
|---------|--------------|
| `make install` | Install dependencies with Poetry |
| `make proto` | Regenerate gRPC code from proto |
| `make run` | Run the service locally |
| `make test` | Run unit tests |
| `make test-coverage` | Run tests with coverage report |
| `make test-integration` | Run integration tests |
| `make lint` | Check code style with Ruff |
| `make inference-up` | Start with Docker (CPU) |
| `make inference-up GPU=1` | Start with Docker (GPU) |
| `make inference-down` | Stop Docker services |
| `make load-test SCENARIO=smoke` | Run load tests |

## Troubleshooting

**Service won't start?**
- Check `API_KEY` is at least 16 characters
- Verify `ENV_TYPE` is `dev` or `prod`
- Look for validation errors in logs (panic at startup)

**Connection refused?**
- Ensure Docker is running: `docker compose -f infra/compose.yml ps`
- Check `GRPC_PORT` is not in use by another process

**Model download failed?**
- Check internet connectivity for HuggingFace downloads
- Verify `HF_TOKEN` if using private repos
- Check `MODEL_CACHE_DIR` has sufficient disk space

**Prod strict failure?**
- `API_KEY` must come from AWS Secrets Manager, not environment
- Ensure `detectai/inference/secrets` exists in AWS

## Related Documentation

- [Architecture](../concepts/architecture.md) - How components connect
- [Request Flows](../concepts/request-flows.md) - How requests are processed
- [Health](../components/health.md) - How to check if configuration is working
- [Observability](../operations/observability.md) - Monitor configuration impact
