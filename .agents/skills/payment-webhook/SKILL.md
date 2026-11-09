---
name: payment-webhook
description: DetectAI's payment-webhook — the Go/Gin webhook gateway that verifies Paddle-signed deliveries and forwards them verbatim to the payment_events.fifo SQS queue (services/payment-webhook). Use when working anywhere in that tree — the handler, validator, or queue adapter, config planes or secrets tooling, the OTel facade, unit/integration tests or the k6 load rig, compose, or its secrets terraform — running, configuring, extending, or debugging the service.
---

# Payment-webhook — the Paddle delivery gateway

A stateless Go/Gin webhook gateway: Paddle signs a delivery, the service
verifies it, and the body is forwarded byte-for-byte to the
`payment_events.fifo` SQS queue for `worker-payments`. No database, no cache,
no connection held — one request is self-contained, and scale means more
instances, never anything inside one. Every delivery takes the same sequential
path: bounded read → Paddle HMAC verify → envelope gate → one enqueue →
answer. Current shape: one ingress (`POST /api/v1/webhook/paddle`) behind one
credential (`PADDLE_WEBHOOK_SECRET` via the `Paddle-Signature` header),
dev/prod config planes, the OTel facade with eight instruments, unit +
integration suites, and a two-scenario k6 rig.

## Map

```text
services/payment-webhook/
├── cmd/api/main.go       the boot: resolve config, bind the SQS publisher, boot observability, serve
├── internal/
│   ├── router/           the gin engine — the /api/v1 group, probes + the single ingress
│   ├── handlers/         the paddle face: bounded read, verify, envelope gate, one publish
│   ├── validator/        ReadBounded · the Paddle HMAC verifier · CheckEnvelope
│   ├── events/           ParseEvent — the one metadata walk over the body
│   ├── queue/            the Message contract · Shape + the group ladder · the budget · SQS adapter
│   ├── config/           typed Config + Resolve · dev/prod planes · fail-fast
│   ├── observability/    the OTel facade: the null build or push to New Relic
│   └── server/           serve until SIGTERM, drain in-flight requests
├── infra/                .env planes, compose files, the k6 load env
├── mk/ + Makefile        make targets: local / docker / tests / load / secrets (tfctl-driven)
├── tests/                unit + integration + load (k6) — a hard tree boundary
├── specification/        design history for maintainers — history, not truth
├── docs/                 the deep documentation tree
└── Dockerfile            the same image serves local compose and Lambda
```

The layering is inward-facing: `router` orchestrates, `handlers` owns
statuses, `validator`/`events`/`queue` own the three real jobs — checking,
parsing, transporting — and `config`/`observability` serve them all. Nothing
inside `queue` knows about HTTP; the handler faces the `Queue` and `Telemetry`
interfaces, never SDK types.

## Run it

```sh
cd services/payment-webhook
make env && make queue-up && make run   # env file, SQS emulator (ElasticMQ), gin on :8080
curl http://localhost:8080/api/v1/health
```

`make env` never overwrites an existing `infra/.env` — set a real
`PADDLE_WEBHOOK_SECRET` (≥ 16 chars) in it before anything real listens.
Docker: `make build && make up`. Probes, the signed-webhook curl recipe, and
the make-target tour: [references/running.md](references/running.md)

## Change the gate without breaking it

- The check order **is** the contract: bounded read → signature → envelope.
  Each one's cost buys the next one's meaning; there is no second lane for
  known types or small bodies, and one delivery never earns two rejections.
- The body crosses **verbatim** — the Paddle JSON byte-for-byte. Metadata
  (dedup id, group id, attributes) rides `MessageAttributes`; the worker needs
  nothing beyond the body.
- One credential, one carrier: `Paddle-Signature` is the only header,
  compared constant-time over `<ts>:<raw-body>` with a ±5-minute freshness
  window. Missing, malformed, stale, and tampered all collapse into one
  generic 401 — indistinguishable on purpose.
- 422 names the missing fields; the two advisories (no `notification_id`, no
  addressable id) are counters, never rejections — a recognizable-but-strange
  Paddle body is a legitimate delivery.
- The group-key ladder (subscription → customer → event_type → default) makes
  groups per-entity ordering domains: same-entity events never reorder, and
  the creation burst spanning groups is deliberate — the worker rebuilds
  cross-entity order from `occurred_at` with `event_id` as tiebreak.
- The publish budget (5 s) bounds every enqueue; a crossed deadline maps to
  503 with `Retry-After`, and the dedup id makes an accepted-but-late attempt
  harmless. `SendMessage`'s 200 is the durability point.
- Metric names are a contract — dashboards query them by name, so a rename
  is a migration, not an edit.
- Finish every change with `make test` (unit + integration in one go).

## Config and secrets rules

- Config is resolved **once at boot** and frozen; changing a knob means a
  restart, never a mid-flight edit.
- The split that matters: numeric bounds fail closed (an unreadable value
  falls back to the safe default), while the credential, queue URL, port, and
  sample ratio fail the boot — a half-configured instance never serves.
- `PADDLE_WEBHOOK_SECRET` is the only credential; the boot validates the value
  itself (non-empty, ≥ 16 chars). Rejections log at warning level and never
  echo the attempted header or signature.
- Dev plane = process env over `infra/.env`. Prod plane = one Secrets Manager
  blob (`detectai/payment-webhook/secrets`) + one SSM prefix read
  (`/detectai/payment-webhook/`). Secrets and SSM config are disjoint planes —
  a key seeded into both is an operator error the boot refuses to paper over.
- One ElasticMQ emulator serves local runs; `QUEUE_URL` is the only queue
  parameter the app knows. Queue creation, redrive, and alarms are IaC —
  never runtime state.

## Infra and testing — the short tours

- **AWS slice:** `make env` → `make secrets-check` (always first) →
  `make secrets-plan` → `make secrets-apply` → `make secrets-verify` —
  fingerprints only, exit 1 on drift. Every verb takes `PLANE=floci|aws`
  (default floci; auto-approved on the emulator plane, interactive on real
  AWS) and `DRY_RUN=1` previews any verb. The whole plane is driven by
  `tools/tfctl` — there is no hand-rolled terraform here.
  Verbs, rotation, gotchas: [references/infra.md](references/infra.md)
- **Tests:** `make test` is the default gate; `make test-unit` for
  logic-only iteration, `make test-integration` for the prod planes (skips,
  not fails, when the emulator is down); the k6 rig is `make load-env` →
  `load-test` / `load-e2e`. What each really runs:
  [references/testing.md](references/testing.md)

## Observability

The whole telemetry build is switched by one env var,
`OTEL_EXPORTER_OTLP_ENDPOINT`: unset boots `NullTelemetry` (legitimate, zero
SDK objects, one code path everywhere); set boots the full pipeline and
additionally requires `NEW_RELIC_LICENSE_KEY` (≥ 16 chars) or the boot fails.
Traces, metrics, and logs push over OTLP/HTTP direct to New Relic EU — the
same Lambda exception as document-parser; no collector hop. Metric names:
`payment_webhooks_received_total`, `payment_webhooks_unknown_event_type_total`,
`payment_webhook_signatures_invalid_total`, `payment_webhook_body_errors_total`,
`payment_webhook_envelope_rejections_total`,
`payment_webhook_envelope_advisories_total`,
`payment_events_published_total`, `payment_events_enqueue_duration_seconds`.
The HTTP route/error/latency panels ride otelgin spans, not app instruments.

Queue-side truth (DLQ depth, oldest-message age, retention) is not this
service's: it surfaces as CloudWatch alarms on Terraform-owned resources,
never as app-instrumented counters. Boards, alerts, and the push pipeline
they rely on belong to the `observability` skill — not this one.

## Guardrails

- Never commit real `infra/.env` or `infra/.env.load` values — only the
  committed templates (`.env.example`, `.env.load.example`) enter git.
- No worker pool, no executor, no connection machinery anywhere — the request
  path is strictly sequential; concurrency lives outside the process (Lambda
  instances, container replicas). Keep the runtime the simplest thing that
  works for one instance.
- No second credential carrier (`x-api-key` or `Authorization: Bearer` twins)
  — every extra envelope multiplies the comparison surface. One secret, one
  header.
- The worker is out of this build's scope: SQS FIFO is the whole contract.
  Don't add broker abstractions, fan-outs, or app-side dedup — Paddle's
  retries collapse in the dedup window, and the worker's idempotency layer is
  the ring-fenced backstop.
- Secrets verbs go through the make targets (tfctl) — no ad-hoc terraform
  against the plane.
- Do not cross service boundaries or share code between services (monorepo
  rule).
- Write documentation under `docs/` in its established style; `specification/`
  records how decisions were made — cite it, don't extend it.

## When you need depth

| Need | Go to |
|------|-------|
| One delivery end to end, boot and runtime model | `services/payment-webhook/docs/concepts/architecture.md` |
| What gets in (bound, signature, envelope) | `services/payment-webhook/docs/concepts/validation.md` |
| Queue contract, group ladder, DLQ, cutover | `services/payment-webhook/docs/concepts/delivery.md` |
| Every env key and fail-fast rule | `services/payment-webhook/docs/getting-started/configuration.md` |
| Endpoint and status-code contract | `services/payment-webhook/docs/reference/http-api.md` |
| What each test suite runs | [references/testing.md](references/testing.md) |
| Local + docker operations | [references/running.md](references/running.md) |
| The secrets stack in detail | [references/infra.md](references/infra.md) |
| The credential's runtime story | `services/payment-webhook/docs/guides/secrets.md` |
| Every make target, annotated | `services/payment-webhook/docs/reference/make.md` |
| Dashboards and alerts | the `observability` skill |
