# Payment Webhook — Design

Module layout, runtime model, and the decisions behind them. Requirements live in [requirements.md](requirements.md); the wire contract in [http.md](http.md); delivery fidelity in [messaging.md](messaging.md); observability in [observability.md](observability.md).

## Module layout

`go run ./cmd/api` is the whole runtime:

```
services/payment-webhook/
  go.mod
  cmd/
    api/
      main.go       # boot: config.Load, the SQS publisher, then server assembly
  internal/
    server/
      server.go     # serve until SIGINT/SIGTERM (NFR-9)
      shutdown.go   # drain within the configured budget, drain logged
    config/
      load.go       # Load: flick → factory → Resolve, wrapped once into ConfigError
      config.go     # Config{Port, DrainTimeout, PaddleSecret} + Resolve — parsed per field
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
      router.go     # gin engine: the /api/v1 group — probes plus the single ingress route
    validator/
      body.go       # ReadBounded + the bound error pair
      paddle.go     # the Paddle HMAC verifier: header grammar, freshness, constant-time compare
      envelope.go   # CheckEnvelope: the Paddle envelope gate — presence-only, warn-level advisory
    events/
      parse.go      # ParseEvent: the one Paddle spelling walk — snake_case ids, the custom_data user, occurred_at
    handlers/
      probes.go     # /api/v1/health, /api/v1/ready — static bodies
      webhook.go    # POST /api/v1/webhook/paddle — bounded read, verify, envelope gate, one publish
      response.go   # the shared rows: the two read rows, the publish rows 200/503/500
    queue/
      queue.go      # the Message contract, the Queue interface, the retryable sentinels
      shape.go      # Shape + the group-key ladder — the message factory consuming events.ParseEvent
      service.go    # the publish budget composition the Paddle face mounts
      sqs.go        # the SQS adapter: SendMessage, the fault mapping, the per-message ceiling
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
        webhook_test.go        # 200/400/401/413/503/500 over the real validator and a fake queue
      router/                  # the paddle face's mounting and guard wiring, black-box
        router_test.go         # the signed publish-through, the retired face's 404, the ceiling clamp
      queue/                   # the transport contract, black-box
        fakes_test.go          # the fake Queue and the fake SQS client seams
        shape_test.go          # the group-key ladder vectors and the dedup id fallback
        service_test.go        # the budget mapping over the fake transport
        sqs_test.go            # the FIFO message shape and the fault-code mapping
  Makefile          # default goal run; help aggregates the per-file help targets
  mk/
    local.mk       # local-dev verbs: tidy, vet, env, run
    tests.mk       # testing verbs: test, test-unit (tests tree boundary)
```

The paddle face mounts the publisher at boot: bounded read, then the signature check, then the envelope gate, then one `Publish`; the 200 goes out only after the SQS response is in. The validator package owns the checks: the bounded read sits beside the paddle-specific verifier and the envelope gate, one file each, stdlib imports only; the handler owns only statuses and bodies and now the verdict calls (`respondReadError` records, the 401/422 sites record and warn per NFR-8, the accepted body records received/unknown/advisories, and the enqueue rides an app span bracketing one timed `Publish` the telemetry partitions with the status). The envelope gate (`envelope.go`) completes the paddle side: presence-only over the four core fields (`event_id`, `event_type`, `occurred_at`, `data`), with `notification_id` and data-addressability advisory-only — the worker keys idempotency on `event_id`, not on Paddle's delivery-layer id, so the delivery envelope can evolve without breaking anything (http.md's envelope section). The advisory addressable-id check calls `queue.ParseEvent` rather than owning a second alias list: messaging.md keeps that list in exactly one place. The interface seams: the transport `queue.Queue` and the telemetry `observability.Telemetry`, each with one fake in the unit matrix — the observability route-span middleware joins the engine inside `router.New` (`observability.Wire`), which no-ops on the null boot. Middleware stays gin's built-in logger/recovery plus that one join. Growth continues file-first within the standing `cmd/` + `internal/` layout: per-provider validators grow as files in the standing directories.

One of each kind still applies when that split happens. The pre-refactor tree carried parallel layers from stacked iterations — `internal/transport/http` alongside `internal/adapters/inbound/http`, `internal/infrastructure/rabbitmq` alongside `internal/adapters/outbound/rabbitmq`, three observability homes. The rebuild collapses to one layer of each that the repo's clean-architecture rule names, with no interface growth beyond the contracts the standing packages carry, and no `ports/messaging.go` leaking AMQP primitives into the domain (the pre-refactor `ports/messaging.go` was an AMQP interface file — the domain depended on broker transport-shaped things). Dependency direction is one-way whenever the split exists: SDK/Gin imports stay out of the inner layers, wiring happens at boot.

## Runtime model

There is **no executor, no worker pool, no connection machinery — anywhere**. The request path is strictly sequential: bounded body read → validate (sign) → envelope gate → parse metadata → enqueue (one `SendMessage` with the 5 s budget) → response 200. Concurrency exists outside the process — Lambda instances — and for the container runtime, replicas. The local compose instance runs the same code path with no in-process pooling, mirroring document-parser's one-code-path-per-runtime model.

Health: `ready` reflects boot validation only (config, credentials, queue URL); there is nothing to check at request time because there is no broker connection to monitor. This deletes the connection-manager gauges and their readiness gate with one stroke ([messaging.md](messaging.md) records what dies).

Shutdown: `signal.NotifyContext` watches SIGINT/SIGTERM; on arrival the server stops accepting and drains in-flight requests within a drain timeout Resolve clamps to never serve shorter than the publish budget plus slack — 10 s with the default budget — then exits with the drain logged, the container-runtime half of NFR-9. Lambda owes no drain (the platform stops the instance); the same signal path is harmless there.

## Error taxonomy

The typed error set, mapped to HTTP exactly once on the face — the read/signature errors live beside their checks, and the queue's retryable pair sits in `internal/queue/queue.go` (no domain package keeps them apart from their consumers):

| Typed error | HTTP | Retryable? |
|-------------|------|------------|
| `ErrBodyTooLarge` | 413 | no |
| `ErrBodyMalformed` (unreadable) | 400 | no |
| `ErrInvalidSignature` | 401 | no |
| envelope fields missing (CheckEnvelope, paddle face) | 422 | no |
| `ErrEnqueueUnavailable` (SQS 5xx/throttle) | 503 + `Retry-After: 5` | yes |
| `ErrDeadlineExceeded` | 503 + `Retry-After: 5` | yes |
| anything unexpected | 500 | no |

All mapping paths use `errors.Is` — the pre-refactor `err.Error() == "invalid signature"` string comparison is deleted, not ported. The 503/`Retry-After` pair is one mapping site for both retryable errors. The 500 catch-all went live with the publisher build: an unmapped transport fault answers it, generic and non-retryable.

## Config planes

Same double-plane shape document-parser landed; this service's own LLD lives in [references/config.md](references/config.md), and the surface is a declared skeleton today — every entry point answers a loud skeleton error until its landing build connects it (dotenv reader + wire-up next, prod plane with AWS):

- **Dev (`ENV_TYPE=dev`)** — env-over-file: process env first, `.env` via godotenv second. Bare keys, no comments — repository convention. Plane values: `PADDLE_WEBHOOK_SECRET`, `QUEUE_URL`, the body bound, the publish budget.
- **Prod (`ENV_TYPE=prod`)** — AWS-exact: no env-file fallback. The license key reads from the service's Secrets Manager blob; `PADDLE_WEBHOOK_SECRET` rides the same blob; `QUEUE_URL` and region from SSM/env as IaC decides. The ~100 ms cold-start cost is accepted in [requirements.md](requirements.md).
- **Validation** — `ENV_TYPE` unset resolves to dev; an unknown flick fails the boot; mandatory values non-empty and ≥ 16 chars (the webhook secret); `QUEUE_URL` a valid SQS URL; bounds parse and fail closed to safe defaults, never partial. Boot fails fast on violation — a mis-provisioned instance never serves.
- **Naming note** — `INTERNAL_API_KEY` and the service-side `API_KEY` both retire with the internal face, which takes its document-parser-inherited credential scheme with it; the caller-side web env name `PAYMENT_GATEWAY_API_KEY` never ships ([requirements.md](requirements.md) knock-ons).

## Packaging (Lambda)

- **Container image via Lambda Web Adapter** — the Go app, config planes, and tests stay unmodified; the same image serves local compose and Lambda. The adapter reads the HTTP server on `PORT` (from `AWS_LWA_PORT` wiring at deploy).
- **Memory 512 MB** per the minimal-CPU profile measured against HMAC+SendMessage; the knob is operational, recorded in [requirements.md](requirements.md)'s Deployment target.
- **Timeout stack**: function timeout 10 s above the in-code publish budget 5 s, API Gateway integration above both — [http.md](http.md)'s front-door section carries the numbers.
- **Go runtime binary** — a scratch/minimal base image; the lambda-build artifact is the static binary.

## Testing strategy

- **Unit** — validator vectors: valid signature, tampered body, stale `ts` (−5 min + 1 s), future `ts` (+5 min + 1 s), missing/malformed header fragments, empty secret; bounded-read vectors (legal at exactly the bound, oversize answers before the excess is consumed, short corrupt transfers answer 400); envelope vectors (the four hard fields absent/blank/null/mistyped, non-object top level, RFC3339-parseability, the two advisory-only signals, open top-level set); config plane fail-closed cases (missing creds, short creds, bad bounds). The group-key ladder and `ParseEvent` vectors landed with the publisher build — their consumer did too.
- **Handler matrix** — the landed face's status surface (200/400/401/413/422/503/500) over the real validator and a fake `Queue`, asserting the envelope and that the bound precedes auth (an oversize body with a garbage signature still answers 413) and that the signature precedes the envelope gate (an unsigned envelope violation answers 401, never 422); a 422 asserts the fake queue saw zero publishes. The metrics rows join the observability build.
- **Integration** — the SQS adapter runs against a fake client in the unit tree (message shape, fault mapping); the Testcontainers Floci fault-injection rig joins its own build, carrying the real `SendMessage` assertions (FIFO attribute values, dedup id, group key, body byte-equality verbatim). The pre-refactor RabbitMQ testcontainers rig does not port.
- **Deferred** — load rig stress/soak profiles ([requirements.md](requirements.md)); e2e contract test updates for the renamed paths are part of the knock-on PRs, not the service's suite.

## Cutover and removal

[messaging.md](messaging.md) owns the cutover sequence (provision → worker deploys SQS consumer → this service flips → Paddle/web flip → RabbitMQ drains and retires). The removal note is the same policy as document-parser's: keep the reference, remove it when its last consumer is migrated; `git log -- services/payment-webhook/slop` recovers everything after.
