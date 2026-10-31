# Payment Webhook — Design

Module layout, runtime model, and the decisions behind them. Requirements live in [requirements.md](requirements.md); the wire contract in [http.md](http.md); delivery fidelity in [messaging.md](messaging.md); observability in [observability.md](observability.md).

Status: drafted ahead of the build. `slop/` stays beside this tree as frozen reference material until the `worker-payments` cutover removes its last consumer, then it is removed and recoverable from git history.

## Module layout

```
services/payment-webhook/
  cmd/
    webhook/
      main.go            # boot: config plane → observability → adapters → server/lambda
  internal/
    domain/
      event.go           # ParseEvent (metadata-only), Event, group-key ladder output
      errors.go          # typed verdicts: ErrInvalidSignature, ErrBodyTooLarge, ErrEnqueueUnavailable, ErrDeadlineExceeded…
      ports/             # Publisher, SignatureValidator, HealthChecker, MetricsRecorder — transport-free interfaces
    application/
      webhook_service.go # the two use cases: ProcessWebhook, ProcessInternalEvent; span attrs + metrics + errors mapped to typed verdicts
    adapters/
      inbound/http/
        routes.go        # gin route group /api/v1; probes excluded from middleware auth paths
        handler.go       # bounded body read (1 MiB + 1), status mapping, error envelope {"error": …}
        probes.go        # /api/v1/health, /api/v1/ready — open, static
        middleware.go    # otelgin + RejectedBody metrics
      outbound/paddle/
        validator.go     # Paddle HMAC: ts=…;h1=…, ±5 min freshness, hmac constant-time compare
      outbound/sqs/
        client.go        # SDK config wiring (region, endpoint override for tests)
        publisher.go     # Publisher: SendMessage with FIFO attributes, env-config budget
    config/
      config.go          # settings contract, fail-closed validation, bounds
      aws.go             # prod plane: Secrets Manager blob, region
      provider.go        # plane flick: dev env-over-file, prod AWS-exact
    observability/
      resource.go        # service.name/version, deployment.environment flick
      logger.go          # slog bridge → OTel logs (otelslog)
      tracing.go         # tracer provider, otelgin wiring
      meters.go          # the metric inventory; the null build behind the NFR-5 gate
      sdk.go             # boot lifecycle: providers or null build; flush-on-shutdown
```

One of each kind. The pre-refactor tree carried parallel layers from stacked iterations — `internal/transport/http` alongside `internal/adapters/inbound/http`, `internal/infrastructure/rabbitmq` alongside `internal/adapters/outbound/rabbitmq`, three observability homes. The rebuild collapses to the one layer of each that the repo's clean-architecture rule names; there is no interface growth beyond the four domain ports, and no `ports/messaging.go` leaking AMQP primitives into the domain (the pre-refactor `ports/messaging.go` was an AMQP interface file — the domain depended on broker transport-shaped things).

Dependency direction is one-way inside: `domain` has zero SDK/Gin imports; `application` depends on `domain` only; adapters depend on application/domain ports; wiring happens in `cmd`.

## Runtime model

There is **no executor, no worker pool, no connection machinery — anywhere**. The request path is strictly sequential: bounded body read → validate → parse metadata → enqueue (one `SendMessage` with the 5 s budget) → response 200. Concurrency exists outside the process — Lambda instances — and for the container runtime, replicas. The local compose instance runs the same code path with no in-process pooling, mirroring document-parser's one-code-path-per-runtime model.

Health: `ready` reflects boot validation only (config, credentials, queue URL); there is nothing to check at request time because there is no broker connection to monitor. This deletes the connection-manager gauges and their readiness gate with one stroke ([messaging.md](messaging.md) records what dies).

## Error taxonomy

One typed error set in `domain/errors.go`, mapped to HTTP exactly once in the transport:

| Typed error | HTTP | Retryable? |
|-------------|------|------------|
| `ErrBodyTooLarge` | 413 | no |
| `ErrBodyMalformed` (unreadable) | 400 | no |
| `ErrInvalidSignature` | 401 | no |
| `ErrInvalidAPIKey` | 401 | no |
| `ErrEnqueueUnavailable` (SQS 5xx/throttle) | 503 + `Retry-After: 5` | yes |
| `ErrDeadlineExceeded` | 503 + `Retry-After: 5` | yes |
| anything unexpected | 500 | no |

All mapping paths use `errors.Is` — the pre-refactor `err.Error() == "invalid signature"` string comparison is deleted, not ported. The 503/`Retry-After` pair is one mapping site for both retryable errors.

## Config planes

Same double-plane shape document-parser landed (its `references/config.md` is the model; the webhook's own LLD lands in `references/`):

- **Dev (`ENV_TYPE=dev`)** — env-over-file: process env first, `.env` via godotenv second. Bare keys, no comments — repository convention. Plane values: `API_KEY`, `PADDLE_WEBHOOK_SECRET`, `QUEUE_URL`, bounds, OTel knobs.
- **Prod (`ENV_TYPE=prod`)** — AWS-exact: no env-file fallback. `API_KEY` and the license key read from the service's Secrets Manager blob; `PADDLE_WEBHOOK_SECRET` rides the same blob; `QUEUE_URL` and region from SSM/env as IaC decides. The ~100 ms cold-start cost is accepted in [requirements.md](requirements.md).
- **Validation** — `ENV_TYPE` ∈ {dev, prod} mandatory; mandatory values non-empty and ≥ 16 chars (the two credentials); `QUEUE_URL` a valid SQS URL; bounds parse and fail closed to safe defaults, never partial. Boot fails fast on violation — a mis-provisioned instance never serves.
- **Naming note** — `INTERNAL_API_KEY` retires with the slop code; the service-side credential is `API_KEY` (scheme inherited from document-parser), and the *caller-side* web env name `PAYMENT_GATEWAY_API_KEY` follows the `FILE_EXTRACTOR_API_KEY` precedent ([requirements.md](requirements.md) knock-ons).

## Packaging (Lambda)

- **Container image via Lambda Web Adapter** — the Go app, config planes, and tests stay unmodified; the same image serves local compose and Lambda. The adapter reads the HTTP server on `PORT` (from `AWS_LWA_PORT` wiring at deploy).
- **Memory 512 MB** per the minimal-CPU profile measured against HMAC+SendMessage; the knob is operational, recorded in [requirements.md](requirements.md)'s Deployment target.
- **Timeout stack**: function timeout 10 s above the in-code publish budget 5 s, API Gateway integration above both — [http.md](http.md)'s front-door section carries the numbers.
- **Go runtime binary** — a scratch/minimal base image; the lambda-build artifact is the static binary.

## Testing strategy

- **Unit** — validator vectors: valid signature, tampered body, stale `ts` (−5 min + 1 s), future `ts` (+5 min + 1 s), missing/malformed header fragments, empty secret; group-key ladder cases through each rung and aliasing; `ParseEvent` metadata extraction incl. unknown shape; config plane fail-closed cases (missing creds, short creds, bad queue URL, bad bounds); the error taxonomy's `errors.Is` mapping.
- **Handler matrix (unit-adapter)** — the full status surface (200/400/401/413/500/503) against fake port implementations (`Publisher`, `Validator`, `MetricsRecorder`), asserting the response envelope and `Retry-After` presence on the retryable rows.
- **Integration** — Testcontainers LocalStack: real `SendMessage` semantics asserted (FIFO attribute values, dedup id, group key, body byte-equality verbatim), and the 503 path via a fault-injected SQS client (SDK call forced to error or hang past the budget). The pre-refactor RabbitMQ testcontainers rig does not port.
- **Deferred** — load rig stress/soak profiles ([requirements.md](requirements.md)); e2e contract test updates for the renamed paths are part of the knock-on PRs, not the service's suite.

## Cutover and removal

[messaging.md](messaging.md) owns the cutover sequence (provision → worker deploys SQS consumer → this service flips → Paddle/web flip → RabbitMQ drains and retires). The removal note is the same policy as document-parser's: keep the reference, remove it when its last consumer is migrated; `git log -- services/payment-webhook/slop` recovers everything after.
