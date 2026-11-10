# Payment Webhook — Requirements

A stateless service that receives payment events over HTTP, validates them, and forwards them to AWS SQS for `worker-payments`.

**Stack:** Go 1.25, Gin.
**Deployed target:** AWS Lambda behind API Gateway — the same container image the local runtime uses, fronted by the Lambda Web Adapter. See [Deployment target](#deployment-target).

Detailed designs: [spec index](README.md) · [HTTP contract](http.md) · [delivery fidelity](messaging.md) · [observability](observability.md) · [design](design.md). User-facing docs: [docs/](../docs/README.md).

## Functional requirements

| ID | Requirement |
|----|-------------|
| FR-1 | Accept Paddle webhooks at `POST /api/v1/webhook/paddle` and validate the `Paddle-Signature` HMAC before any other work |
| FR-2 | Reject missing, malformed, stale, or tampered signatures with 401 (generic message; the failure classes are indistinguishable) |
| FR-3 | Reject bodies whose envelope is incomplete — absent or blank `event_id`/`event_type`, unparseable `occurred_at`, or non-object `data` — with 422 naming the fields, after signature validation ([http.md](http.md)'s envelope check) |
| FR-4 | Forward every authenticated event to the payment events FIFO queue, body byte-for-byte, with transport attributes for `source`, `event_type`, and `event_id` ([messaging.md](messaging.md)) |
| FR-5 | Return 200 `{"status":"queued"}` once SQS accepts the message — the `SendMessage` 200 is the durability guarantee (no in-flight buffering, no publisher-confirm dance) |
| FR-6 | Return clear error responses: unreadable/malformed body 400, oversized body 413, enqueue unavailable 503 with `Retry-After`, unexpected failure 500 |
| FR-7 | Queue events whose `event_type` cannot be recognized rather than rejecting them; count them (unknown type is a worker-side concern, not an admission error) |
| FR-8 | Serve `/api/v1/health` and `/api/v1/ready` open, without authentication, for probes and local runtimes |

## Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Stateless: no database, no persistent storage, no instance-to-instance state; every instance resolves its own config at boot |
| NFR-2 | One request must not block another. On Lambda the platform provides this — one request per instance, scaling adds instances. The in-code request path (validate → enqueue) is strictly sequential and identical across runtimes |
| NFR-3 | Every request completes, succeeds, or fails within the 5-second in-code publish budget (configurable). The timeout stack layers so the shaped response wins every race: API GW integration (≤ 29 s) > function timeout (10 s) > in-code budget (5 s). A deadline exceeded mid-enqueue answers 503 with `Retry-After: 5`; a late-accepted attempt deduplicates on the same `MessageDeduplicationId`, so the ambiguity costs nothing. A platform timeout is an opaque 502, never the spec-shaped response — the layering above makes this unreachable in practice |
| NFR-4 | Request body is bounded (1 MiB default, clamped to SQS's 256 KiB at the router) — rejected before any auth work; oversized bodies answer 413 naming the effective limit |
| NFR-5 | Observability is OTel-native — logs, traces, and metrics export via OTLP push when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured; without it nothing is emitted. No pull metrics endpoint. Metric names are a stable contract and change only with a dashboard/alert migration ([observability.md](observability.md)) |
| NFR-6 | Health and readiness endpoints for probes and orchestrators, kept in the contract for local parity. On Lambda the platform owns availability and shedding; readiness is a static signal once boot validation passes |
| NFR-7 | Tests: unit and integration suites cover the service (status-code matrix, validators, group-key ladder, SQS shape); the k6 load/e2e rig runs the smoke and load scenarios |
| NFR-8 | Authentication failures are logged at warning level and counted as rejected requests |
| NFR-9 | Container-runtime behavior: SIGTERM stops new requests and drains in-flight enqueues within one publish budget + slack, with the drain logged; `DRAIN_TIMEOUT` is clamped to never serve shorter than budget + 5 s. Lambda has no drain; the platform stops the instance |

## Authentication scheme

One producer, one credential — the Paddle webhook secret, validated before any other work:

| Piece | Decision |
|-------|----------|
| Credential | `PADDLE_WEBHOOK_SECRET` — from Paddle's dashboard, mandatory in every environment; in prod it rides the Secrets Manager blob, elsewhere env |
| Validation at boot | Non-empty and at least 16 characters |
| Header | `Paddle-Signature` — `ts=<unix-seconds>;h1=<hex>`, HMAC-SHA256 over `<ts>:<raw-body>` |
| Comparison | Constant-time, plus the ±5 min freshness window |
| Failure | 401 with a generic message; missing, malformed, stale, and tampered signatures are indistinguishable |
| Signals | Rejections log at warning; `payment_webhook_signatures_invalid_total` counts them (landed with the observability build) |

The internal face and its `x-api-key` scheme retired with the gateway going Paddle-only — the old `INTERNAL_API_KEY`/`API_KEY` names are gone from the service.

## Deployment target

AWS Lambda behind API Gateway, synchronous proxy integration — the runtime shape document-parser already runs, chosen for operational sameness (one adapter image, one secrets plane, one IaC pattern for two front-door services). The survey, recorded so the choice survives its authors:

| Runtime | Binding constraint | Verdict |
|---------|--------------------|---------|
| Lambda behind API Gateway | 6 MB invocation payload; 10 MB API GW body cap | viable — bodies are tiny here |
| ALB → Lambda | 1 MB request body — hard limit | viable but unnecessary divergence |
| ECS Fargate behind ALB | no payload ceiling; long-lived process | the fallback if standing connections are ever needed |
| Lambda behind URL (no API GW) | no custom-domain stitching with the rest of the stack | rejected for front-door consistency |

Operational notes: memory 512 MB (HMAC + one `SendMessage`; no CPU-hungry phase), function timeout 10 s above the 5 s budget so the shaped 503 wins the race, the Lambda Web Adapter over the existing image so app and tests stay unmodified, and the prod Secrets Manager read adding ~100 ms to cold starts — accepted. API Gateway buffers the full request body before invoking; at the service's 256 KiB effective bound that buffering is bounded. SQS reachability (public endpoint via NAT, or a VPC endpoint) is provisioning-plane detail recorded with the IaC.

## Numeric bounds

| Bound | Default | Failure behavior |
|-------|---------|------------------|
| Request body | 1 MiB, clamped at the router to SQS's 256 KiB ceiling | Reject with 413 naming the effective limit, before validation |
| In-code publish budget | 5 s | 503 with `Retry-After: 5`; enqueue attempt abandoned |
| SQS message retention (main, DLQ) | 14 days | Queue-level setting (IaC); dead events older than 14 days are lost — bounded by depth/age alarms ([messaging.md](messaging.md)) |
| SQS visibility timeout | 300 s | Queue-level; must exceed the worker's maximum processing time |
| Redrive maxReceiveCount | 5 | After 5 receive attempts the event moves to the DLQ |
| SQS dedup window | 5 min | Fixed by AWS; beyond it Paddle duplicates re-reach the worker, whose idempotency layer remains the backstop |

HTTP bounds are configurable at boot via environment variables with fail-closed behavior: an unset or invalid value falls back to the safe default. Queue-level bounds live in Terraform and change only with the [messaging.md](messaging.md) contract.

## Explicitly out of scope

- Any provider beyond Paddle — the gateway accepts no other producer
- Service-level dedup storage (Redis/DB) — SQS dedup plus worker idempotency covers it
- Rate limiting, admission control (429/503 on saturation) — shedding is not this service's lever
- DLQ inspection/replay tooling — console + CLI is the accepted operational surface
- EventBridge or SNS in the delivery path — one consumer, no fanout ([messaging.md](messaging.md) records the survey)

## Knock-ons

Tracked so the contract change stays visible — the landed half and the pending half:

**Landed with this build:**

- **Observability assets** — the `payment-webhook` board (prod/dev twins) and the alert policy's 5xx-span and publish-failure conditions are live ([observability.md](observability.md))
- **Secrets tooling** — the service's Secrets Manager blob (`PADDLE_WEBHOOK_SECRET`, `NEW_RELIC_LICENSE_KEY`) is in the tfctl seed flow (`make secrets-*`)

**Pending (own PRs):**

- **`worker-payments`** — the SQS consumer of `payment_events.fifo`; the RabbitMQ consumer retires at cutover ([messaging.md](messaging.md)'s order)
- **Paddle dashboard** — webhook destination re-pointed to `<host>/api/v1/webhook/paddle`
- **Queue provisioning** — Terraform creates the FIFO queue, FIFO DLQ, redrive policy, and CloudWatch alarms
- **`apps/web` cancel route** — deferred with apps/web's other work: it calls Paddle's cancel API directly (period-end, `effective_from: "next_billing_period"`) with the app's own auth — a user cancels only their own subscription
- **`apps/web` BFF status route** — `app/api/services/payment-gateway/status` polls `/readyz` → `/api/v1/ready`
- **`apps/web` docs and env** — configuration/request-flows/services pages name the old path and header; no `PAYMENT_GATEWAY_API_KEY` ever ships (the web's other `INTERNAL_API_KEY` is a different credential, untouched)
- **Load rigs** — `apps/web/test/load/mock-server` faked the internal path and its env carried that key; both retire with the face
- **Observability additions** — a condition on `payment_webhook_signatures_invalid_total` (tamper/replay signal); queue-side alarms land with the queue provisioning
