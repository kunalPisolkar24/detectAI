# detectai-inference

gRPC inference service for DetectAI. It serves the `inference.v1` contract over the `DetectAI` text-detection models: `Detect` (unary) and `AnalyzeDocument` (server-streaming), plus the standard `grpc.health.v1` surface.

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

`Check` returns `SERVING` for the overall service (`''`) and for `inference.v1.AIService`, and `NOT_FOUND` for any unknown service name.

## Contract

`api/proto/ai_service.proto` defines the standing contract: `Detect` (unary) and `AnalyzeDocument` (server-streaming) under `inference.v1`. `make proto` generates the Python stubs into `app/serving/generated/`. See `specifications/references/inference-api-contract.md` for the pinned semantics.

Every RPC except the health check demands `x-api-key` metadata matching `API_KEY`, answered `UNAUTHENTICATED` otherwise. The `MAX_TEXT_CHARS` submission bound (default 1,000,000) is enforced on both RPCs; a bad input answers `INVALID_ARGUMENT`, a saturated model answers `RESOURCE_EXHAUSTED`, and an unexpected failure answers `INTERNAL`.

`Detect` returns the document's verdict. `AnalyzeDocument` streams the same verdict: a `started` event with the document's shape, coalesced `progress` events as its chunks land, and the `result` event last. The confidences on the wire are 0-100 percentages, and the `model_id` names the model that answered (`spark` by default, `flare` or `spark`).
