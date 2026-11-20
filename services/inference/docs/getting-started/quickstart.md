# Quick Start

Get the service up, prove it is healthy, and make one call of each kind.

## 1. Boot

```sh
make install   # poetry install
make env       # create infra/.env from the template if missing
make run       # poetry run python -m app.main
```

The boot is fail-closed: config, model pull, load, and warmup all finish before the server starts listening. On a cold cache the first boot downloads model artifacts (hundreds of MB), so it is not instant.

The server binds `GRPC_PORT`, default `50051`. Logs say which plane resolved, which models loaded, and how long warmup took.

## 2. Check health

```sh
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
```

Both `''` and `inference.v1.AIService` report `SERVING`. Health is open — no key needed.

## 3. Load the key

`API_KEY` lives in `infra/.env` in dev. Export it for the calls below:

```sh
set -a; . infra/.env; set +a
```

## 4. One unary verdict

```sh
grpcurl -plaintext \
  -H "x-api-key: $API_KEY" \
  -d '{"text":"The report was drafted by a language model.","model_id":"spark"}' \
  localhost:50051 inference.v1.AIService/Detect
```

The answer carries both confidences as 0–100 percentages, the AI flag, and one highlight span per scored region. Leaving `model_id` empty selects `spark`.

## 5. One streamed analysis

```sh
grpcurl -plaintext \
  -H "x-api-key: $API_KEY" \
  -d '{"text":"A longer document goes here.","model_id":"spark"}' \
  localhost:50051 inference.v1.AIService/AnalyzeDocument
```

You get a `started` event (character and chunk counts), up to 20 coalesced `progress` events, and one `result` event with the same verdict shape as `Detect`.

## 6. Explore the schema

Dev registers gRPC reflection, so `grpcurl` can discover the contract:

```sh
grpcurl -plaintext localhost:50051 list
grpcurl -plaintext localhost:50051 describe inference.v1.DetectRequest
```

Reflection is dev-only and open; prod registers nothing extra.

## What to read next

- **[Configuration](configuration.md)** — every knob and the dev/prod planes.
- **[Architecture](../concepts/architecture.md)** — what the boot just wired.
- **[RPC API](../reference/rpc-api.md)** — the full wire contract.
