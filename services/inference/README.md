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

`Check` returns `SERVING` for the overall service (`''`) and `NOT_FOUND` for any unknown service name. `Detect`/`AnalyzeDocument`, the proto, tests, and the Dockerfile arrive with the next slice.
