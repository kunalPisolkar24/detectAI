# detectai-inference

gRPC inference service for DetectAI. Bootstrap slice: only the standard `grpc.health.v1` surface is served.

## Quickstart

```sh
make install
make run
```

The server listens on `GRPC_PORT` (default `50051`).

## Health

```sh
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
```

`Check` returns `SERVING` for the overall service (`''`) and `NOT_FOUND` for any unknown service name.

## Contract

`api/proto/ai_service.proto` defines the standing contract: `Detect` (unary) and `AnalyzeDocument` (server-streaming) under `inference.v1`. `make proto` generates the Python stubs into `app/serving/generated/`. See `specifications/references/inference-api-contract.md` for the pinned semantics. The servicer arrives with the next slice; `Detect`/`AnalyzeDocument` still return `UNIMPLEMENTED`.
