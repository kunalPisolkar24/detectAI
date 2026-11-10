# Payment Webhook — Design

Module layout, runtime model, and the decisions behind them. Requirements live in [requirements.md](requirements.md); the wire contract in [http.md](http.md); delivery fidelity in [messaging.md](messaging.md); observability in [observability.md](observability.md).

## Module layout

```
services/payment-webhook/
  go.mod
  cmd/
    api/main.go        # boot: flick → config.Load → the SQS publisher → observability → serve
  internal/
    server/            # serve until SIGINT/SIGTERM (NFR-9)
      server.go        #   signal.NotifyContext, the serve loop
      shutdown.go      #   drain within DRAIN_TIMEOUT, drain logged
    config/
      load.go          # Load: flick → factory → Resolve, wrapped once into ConfigError
      config.go        # Config + Resolve — parsed per field, fail-fast / fail-closed split
      interfaces.go    # contracts hub: the Source plane contract
      errors.go        # the Load-boundary ConfigError wrapper
      planes/          # source.go · dev_source.go (env over dotenv) · prod_source.go (blob + SSM)
      adapters/        # dotenv.go · parameters.go (SSM tree) · secrets_manager.go (JSON blob)
      factories/       # config_factory.go (the flick wiring) · aws_client_factory.go
    router/
      router.go        # gin engine: the /api/v1 group — probes + the ingress, otelgin wired
    validator/
      body.go          # ReadBounded + the ErrBodyTooLarge/ErrBodyMalformed pair
      paddle.go        # the Paddle HMAC verifier: header grammar, freshness, constant-time compare
      envelope.go      # CheckEnvelope: presence-only over the four core fields + advisories
    events/
      parse.go         # ParseEvent: the one Paddle spelling walk, shared by gate and shaping
    handlers/
      probes.go        # /health, /ready — static bodies
      webhook.go       # the paddle face: bounded read, verify, gate, one publish, verdict calls
      response.go      # the read rows, the publish rows 200/503/500, Retry-After
    queue/
      queue.go         # the Message contract, the Queue interface, the retryable sentinels
      shape.go         # Shape + the group-key ladder
      service.go       # the publish budget composition (deadline → ErrDeadlineExceeded)
      sqs.go           # the SQS adapter: SendMessage, fault mapping, the 256 KiB ceiling
    observability/
      interfaces.go    # the Telemetry seam + the attribution vocabularies — no OTel imports
      null.go          # the disabled boot's realization
      service.go       # frozen instrument names + every recording method
      boot.go          # the endpoint gate, exporters, adapters, the slog tee
      otlp.go          # signal paths, gzip, the api-key header
      resource.go      # service.name / version / deployment labels
      adapters/        # one SDK provider per signal, start-once
  tests/
    unit/              # one black-box package per component (config, validator, handlers,
                       #   router, queue, observability) with fakes at every seam
    integration/config/  # the prod planes through the seeded floci emulator, skips when down
    load/              # the k6 rig: lib/, scenarios/{smoke,load}.js, README
  Makefile             # help aggregates the per-file targets
  mk/                  # local.mk · docker.mk · tests.mk · secrets.mk · load.mk
```

## The ingress face and the seams

One face mounts one publish: bounded read, then the signature check, then the envelope gate, then one `Publish` — the 200 goes out only after the SQS response is in. The packages split exactly along the three real jobs:

- `validator` owns the checks — the bounded read beside the paddle-specific verifier and the envelope gate, one file each, stdlib imports only.
- `events` owns the parse — envelope advisories and message shaping both call `ParseEvent`, so the Paddle spellings live in exactly one place ([messaging.md](messaging.md)'s ladder).
- `handlers` owns statuses and bodies — it maps typed errors onto rows and folds the verdict calls through the telemetry seam; the enqueue rides an application span bracketing one timed `Publish`.
- `queue` owns transport — the `Message` contract, the group ladder, the publish budget, and the SQS adapter, with fault codes mapped to the two retryable sentinels.

The interface seams are exactly two: the transport `queue.Queue` and the telemetry `observability.Telemetry`, each with one fake in the unit matrix. Middleware is gin's logger/recovery plus the single otelgin join (`observability.Wire`), which no-ops on the null boot.

## Runtime model

There is **no executor, no worker pool, no connection machinery — anywhere**. The request path is strictly sequential: bounded body read → verify → envelope gate → parse metadata → enqueue (one `SendMessage` with the 5 s budget) → response 200. Concurrency exists outside the process — Lambda instances, container replicas — exactly the model document-parser runs on the same front door.

- **Health** reflects boot validation only (config, credentials, queue URL); there is nothing to check at request time because there is no broker connection to monitor ([messaging.md](messaging.md) records what dies).
- **Shutdown** watches SIGINT/SIGTERM via `signal.NotifyContext`; on arrival the server stops accepting and drains in-flight requests within `DRAIN_TIMEOUT`, clamped to never serve shorter than the publish budget plus slack (10 s at the default), drain logged.

## Error taxonomy

The typed error set, mapped to HTTP exactly once on the face — the read/signature errors live beside their checks, the queue's retryable pair sits in `internal/queue/queue.go`:

| Typed error | HTTP | Retryable? |
|-------------|------|------------|
| `ErrBodyTooLarge` | 413 | no |
| `ErrBodyMalformed` (unreadable) | 400 | no |
| `ErrInvalidSignature` | 401 | no |
| envelope fields missing (CheckEnvelope) | 422 | no |
| `ErrEnqueueUnavailable` (SQS 5xx/throttle) | 503 + `Retry-After` | yes |
| `ErrDeadlineExceeded` (budget) | 503 + `Retry-After` | yes |
| anything unexpected | 500 | no |

All mapping paths use `errors.Is` — the pre-rebuild `err.Error() == "…"` string comparison is deleted, not ported; the 503/`Retry-After` pair is one mapping site for both retryable errors.

## Config planes

Same double-plane shape document-parser landed; the [config LLD](references/config.md) is this service's own:

- **Dev (`ENV_TYPE=dev`)** — env-over-file: process env first, `infra/.env` second. Bare keys, no comments — repository convention.
- **Prod (`ENV_TYPE=prod`)** — AWS-exact: the Secrets Manager blob (`detectai/payment-webhook/secrets`) and the SSM prefix tree (`/detectai/payment-webhook/`); env-file fallbacks cannot leak a value in. The ~100 ms cold-start cost is accepted in [requirements.md](requirements.md).
- **Validation** — unset `ENV_TYPE` resolves to dev; an unknown flick fails the boot; the webhook secret is mandatory at the 16-char floor; `QUEUE_URL` must parse as a queue URL; bounds fail closed to their safe defaults. Boot fails fast on violation — a mis-provisioned instance never serves.

## Packaging (Lambda)

- **Container image via the Lambda Web Adapter** — the Go app, config planes, and tests stay unmodified; the same image serves local compose and Lambda.
- **Memory 512 MB**, timeout stack 10 s over the 5 s budget — per [requirements.md](requirements.md)'s deployment target; a minimal base image with the static Go binary as the build artifact.

## Testing strategy

- **Unit** — one black-box package per component: validator vectors (bound legality at exactly `max`, oversize answering before the excess is consumed; signature classes fresh/stale/future/tampered/malformed; the envelope's four hard fields absent/blank/null/mistyped plus the two advisories), the group-key ladder and `ParseEvent` vectors, the budget mapping and SQS fault-code mapping over fakes, the handler status matrix over the real validator and a fake queue (order initials: an oversize body with a garbage signature still answers 413, an unsigned envelope violation answers 401), and the observability boot against an in-process OTLP receiver.
- **Integration** — the prod config planes through the seeded floci emulator (`tests/integration/config`), skipped when the emulator is down. The pre-rebuild RabbitMQ testcontainers rig does not port; an SQS fault-injection rig, if wanted, joins the queue IaC build.
- **Load/e2e** — the k6 rig (`tests/load`): the smoke scenario walks the full rejection matrix, the load scenario shapes `ramping-arrival-rate` profiles from `infra/.env.load` ([tests/load/README.md](../tests/load/README.md)).

## Cutover and removal

[messaging.md](messaging.md) owns the cutover sequence (provision → worker deploys the SQS consumer → this service flips → Paddle/web flip → RabbitMQ drains and retires). The reference build-out (`slop/`) was kept as reference material while this one was built; it is now removed, recoverable from git history.
