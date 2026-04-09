# Inference k6 Load Tests

This suite targets the inference gRPC service directly.

The runner reads the existing repo env files, generates a bearer token from `AI_SERVICE_API_KEY`, and runs `grafana/k6` in Docker. By default it targets `host.docker.internal:${PORT_INFERENCE}` from the selected env file.

## Scripts

- `services/inference/load/scenarios/smoke.js`
- `services/inference/load/scenarios/detect.js`

## Local

Start the inference target first.

```bash
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml up -d ai-service
make -C services/inference load-smoke-local
make -C services/inference load-detect-local
```

## Production

Start the target stack first.

```bash
docker compose --env-file infra/docker/prod/.env -f infra/docker/prod/compose.yml up -d ai-service
make -C services/inference load-smoke-prod
make -C services/inference load-detect-prod
```

## Useful Overrides

```bash
INFERENCE_LOAD_MODELS=spark
INFERENCE_LOAD_TEXT_PROFILES=short,medium,large,near_limit
INFERENCE_LOAD_DETECT_STAGES=30s:10,2m:20,30s:0
INFERENCE_LOAD_DETECT_PREALLOCATED_VUS=40
INFERENCE_LOAD_DETECT_MAX_VUS=120
INFERENCE_LOAD_DETECT_P95_MS=1200
INFERENCE_LOAD_DETECT_P99_MS=2200
INFERENCE_LOAD_DETECT_MIN_SUCCESS_RATE=0.995
```

Example:

```bash
INFERENCE_LOAD_MODELS=spark INFERENCE_LOAD_DETECT_STAGES=1m:15,1m:25,30s:0 make -C services/inference load-detect-local
```

If the target is not exposed on the default published port, override `INFERENCE_LOAD_GRPC_TARGET`.
