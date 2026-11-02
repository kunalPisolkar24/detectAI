# Payment Webhook — Design

Module layout, runtime model, and the decisions behind them. Requirements live in [requirements.md](requirements.md); the wire contract in [http.md](http.md); delivery fidelity in [messaging.md](messaging.md); observability in [observability.md](observability.md).

## Module layout

`go run ./cmd/api` is the whole runtime:

```
services/payment-webhook/
  go.mod
  cmd/
    api/
      main.go       # boot: config.Load, then server assembly
  internal/
    server/
      server.go     # serve until SIGINT/SIGTERM (NFR-9)
      shutdown.go   # drain within the configured budget, drain logged
    config/
      load.go       # Load: flick → factory → Resolve, wrapped once into ConfigError
      config.go     # Config{Port, DrainTimeout, APIKey} + Resolve — parsed per field
      interfaces.go # contracts hub: the Source plane contract
      errors.go     # the Load-boundary ConfigError wrapper
      adapters/
        dotenv.go     # dev file plane reader
        parameters.go # prod SSM tree reader — skeleton (AWS build)
        secrets_manager.go # prod secrets blob reader — skeleton (AWS build)
      planes/
        source.go      # the Source plane contract
        dev_source.go  # dev plane: env over dotenv
        prod_source.go # prod plane: blob + SSM disjoint — skeleton (AWS build)
      factories/
        config_factory.go      # the flick wiring: dev wired, prod refuses
        aws_client_factory.go  # bootstrap clients — skeleton (AWS build)
    router/
      router.go     # gin engine: root probes, the /api/v1 route group
      middleware.go # RequireAPIKey: the shared x-api-key guard for the internal face
    validator/
      body.go       # ReadBounded + the bound error pair — the check both faces share
      paddle.go     # the Paddle HMAC verifier: header grammar, freshness, constant-time compare
    handlers/
      probes.go     # /health, /ready — static bodies
      webhook.go    # POST /api/v1/webhook/paddle — bounded read, signature verification, the mapping
      events.go     # POST /api/v1/internal/events — static 200 {"status":"queued"}
  tests/
    unit/
      config/                # one black-box config_test package, document-parser's tests-tree layout
        helpers_test.go        # shared: plane writers, the adapter reader
        dotenv_test.go         # the dotenv grammar and its path modes
        dev_source_test.go     # env wins over the file
        config_factory_test.go # dev wired, prod refuses
        config_test.go         # the flick, Resolve contracts, Load end-to-end
      validator/               # the bounded read and the signature verifier, black-box
        body_test.go           # the bound vectors: legality at max, oversize, no excess consumed
        paddle_test.go         # signature classes: fresh, stale, future, tampered, malformed fragments
      handlers/                # the paddle face's status mapping, black-box
        webhook_test.go        # 200/400/401/413 over the real validator
      router/                  # the x-api-key guard, black-box
        router_test.go         # identical 401s, the shared key serves, the paddle face signature-gated
  Makefile          # default goal run; help aggregates the per-file help targets
  mk/
    local.mk       # local-dev verbs: tidy, vet, env, run
    tests.mk       # testing verbs: test, test-unit (tests tree boundary)
```

The Paddle face serves verification end to end: bounded read, signature check, the contract envelope — the internal face stays static until the publisher build mounts its `Publisher` dep, wired at boot. The validator package owns the checks: the bounded read both faces share sits beside the paddle-specific verifier, one file each, stdlib imports only; the handler owns only statuses and bodies. There is no interface port seam — one implementation, and the handler-matrix tests run the real validator; the seam returns only if the publisher build creates a second copy. Middleware stays gin's built-in logger/recovery (otelgin joins with the observability build). Growth continues file-first within the standing `cmd/` + `internal/` layout: the publisher and per-face validators grow as files in the standing directories.

One of each kind still applies when that split happens. The pre-refactor tree carried parallel layers from stacked iterations — `internal/transport/http` alongside `internal/adapters/inbound/http`, `internal/infrastructure/rabbitmq` alongside `internal/adapters/outbound/rabbitmq`, three observability homes. The rebuild collapses to one layer of each that the repo's clean-architecture rule names, with no interface growth beyond the contracts the standing packages carry, and no `ports/messaging.go` leaking AMQP primitives into the domain (the pre-refactor `ports/messaging.go` was an AMQP interface file — the domain depended on broker transport-shaped things). Dependency direction is one-way whenever the split exists: SDK/Gin imports stay out of the inner layers, wiring happens at boot.

## Runtime model

There is **no executor, no worker pool, no connection machinery — anywhere**. The request path is strictly sequential: bounded body read → validate → parse metadata → enqueue (one `SendMessage` with the 5 s budget) → response 200. Concurrency exists outside the process — Lambda instances — and for the container runtime, replicas. The local compose instance runs the same code path with no in-process pooling, mirroring document-parser's one-code-path-per-runtime model.

Health: `ready` reflects boot validation only (config, credentials, queue URL); there is nothing to check at request time because there is no broker connection to monitor. This deletes the connection-manager gauges and their readiness gate with one stroke ([messaging.md](messaging.md) records what dies).

Shutdown: `signal.NotifyContext` watches SIGINT/SIGTERM; on arrival the server stops accepting and drains in-flight requests within a 10 s drain timeout — the 5 s publish budget plus slack — then exits with the drain logged, the container-runtime half of NFR-9. Lambda owes no drain (the platform stops the instance); the same signal path is harmless there.

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

All mapping paths use `errors.Is` — the pre-refactor `err.Error() == "invalid signature"` string comparison is deleted, not ported. The 503/`Retry-After` pair is one mapping site for both retryable errors. In the validator build the 500 catch-all is unreachable: the only error sources are the bounded read and the signature check, both fully mapped on their faces — the publisher build's failure modes bring it live.

## Config planes

Same double-plane shape document-parser landed; this service's own LLD lives in [references/config.md](references/config.md), and the surface is a declared skeleton today — every entry point answers a loud skeleton error until its landing build connects it (dotenv reader + wire-up next, prod plane with AWS):

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

- **Unit** — validator vectors: valid signature, tampered body, stale `ts` (−5 min + 1 s), future `ts` (+5 min + 1 s), missing/malformed header fragments, empty secret; bounded-read vectors (legal at exactly the bound, oversize answers before the excess is consumed, short corrupt transfers answer 400); config plane fail-closed cases (missing creds, short creds, bad bounds). The group-key ladder and `ParseEvent` vectors land with the publisher build — their consumer does too.
- **Handler matrix** — the landed face's status surface (200/400/401/413) over the real validator, asserting the envelope and that the bound precedes auth (an oversize body with a garbage signature still answers 413); the 503/500 rows and the fake `Publisher`/`MetricsRecorder` ports join the publisher build, when the matrix grows to them.
- **Integration** — Testcontainers LocalStack: real `SendMessage` semantics asserted (FIFO attribute values, dedup id, group key, body byte-equality verbatim), and the 503 path via a fault-injected SQS client (SDK call forced to error or hang past the budget). The pre-refactor RabbitMQ testcontainers rig does not port.
- **Deferred** — load rig stress/soak profiles ([requirements.md](requirements.md)); e2e contract test updates for the renamed paths are part of the knock-on PRs, not the service's suite.

## Cutover and removal

[messaging.md](messaging.md) owns the cutover sequence (provision → worker deploys SQS consumer → this service flips → Paddle/web flip → RabbitMQ drains and retires). The removal note is the same policy as document-parser's: keep the reference, remove it when its last consumer is migrated; `git log -- services/payment-webhook/slop` recovers everything after.
