# Payment Webhook — Requirements

A stateless service that receives payment events over HTTP, validates them, and forwards them to AWS SQS for `worker-payments`.

**Stack:** Go 1.25, Gin.
**Deployed target:** AWS Lambda behind API Gateway — the same container image the local runtime uses, fronted by the Lambda Web Adapter. See [Deployment target](#deployment-target).

Detailed designs: [spec index](README.md) · [HTTP contract](http.md) · [delivery fidelity](messaging.md) · [observability](observability.md) · [design](design.md)

## Functional requirements

| ID | Requirement |
|----|-------------|
| FR-1 | Accept Paddle webhooks at `POST /api/v1/webhook/paddle` and validate the `Paddle-Signature` HMAC before any other work |
| FR-2 | Reject missing, malformed, stale, or tampered signatures with 401 (generic message; the failure classes are indistinguishable in the response) |
| FR-3 | Accept internal events at `POST /api/v1/internal/events`, authenticated with the shared secret `API_KEY` — see [Authentication scheme](#authentication-scheme) |
| FR-4 | Forward every authenticated event to the payment events FIFO queue with the body carried byte-for-byte and transport attributes for `source`, `event_type`, and `event_id` (see [messaging.md](messaging.md)) |
| FR-5 | Return 200 `{"status":"queued"}` once SQS accepts the message — SQS's success response is the durability guarantee (no in-flight buffering, no publisher-confirm dance) |
| FR-6 | Return clear error responses when a request cannot be processed: unreadable or malformed body 400, oversized body 413, enqueue unavailable 503 with `Retry-After`, unexpected failure 500 |
| FR-7 | Queue events whose `event_type` cannot be recognized rather than rejecting them; count them (unknown type is a worker-side concern, not an admission error) |
| FR-8 | Serve `/health` and `/ready` open, without authentication, for probes and local runtimes |

### Authentication scheme

The internal ingress inherits the document-parser scheme verbatim — one credential, one header, one comparison path:

| Piece | Decision |
|-------|----------|
| Credential | Shared secret `API_KEY` — mandatory in every environment (dev, load rig, prod); in prod it is delivered via Secrets Manager, elsewhere via env |
| Validation at boot | Non-empty and at least 16 characters |
| Headers | `x-api-key` only — no `Authorization`/`Bearer` processing |
| Comparison | Constant-time over the UTF-8 bytes |
| Failure | 401 with a generic message; missing and invalid credentials are indistinguishable in the response |
| Logging | Rejections are logged (NFR-8) at warning level without echoing the attempted key; the rejected-request counter lands with the metrics build |

The Paddle ingress keeps its own credential — `PADDLE_WEBHOOK_SECRET` (non-empty, ≥ 16 characters, fail-fast) validating the `Paddle-Signature` HMAC — so the two faces have distinct secrets, distinct headers, and distinct comparison paths. The old `INTERNAL_API_KEY` name retires with the rebuild; see [Knock-ons](#knock-ons).

## Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Stateless: no database, no persistent storage, no instance-to-instance state; every instance resolves its own config at boot |
| NFR-2 | One request must not block another. On Lambda this is platform-provided — one request per instance, scaling adds instances. The in-code request path (validate → enqueue) is strictly sequential and identical across runtimes |
| NFR-3 | Every request completes, succeeds, or fails within a 5-second in-code publish budget (configurable). The timeout stack layers so the service's shaped response wins every race: API GW integration (≤ 29 s) > function timeout (10 s) > in-code budget (5 s). A deadline exceeded mid-enqueue answers 503 with `Retry-After: 5`; if SQS actually accepted the message the attempt deduplicates (same `MessageDeduplicationId`), so the ambiguity costs nothing. A platform timeout is an opaque 502, never the spec-shaped response — the layering above makes this unreachable in practice |
| NFR-4 | Request body is bounded (1 MiB default, configurable) — rejected before any auth work beyond the bound; oversized bodies answer 413 named at the limit |
| NFR-5 | Observability is OTel-native — logs, traces, and metrics export via OTLP push when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured; without it nothing is emitted. There is no pull metrics endpoint. Metric names are a stable contract and change only with a dashboard/alert migration (see [observability.md](observability.md)) |
| NFR-6 | Health and readiness endpoints for probes and orchestrators, kept in the contract for local parity. On Lambda the platform owns availability and shedding; readiness is a static signal once boot validation passes |
| NFR-7 | Tests: unit and integration tests cover the service (status-code matrix, validators, group-key ladder, enqueue adapter). The load/e2e rig updates are deferred — see [Deferred](#deferred) |
| NFR-8 | Authentication failures are logged and counted as rejected requests |
| NFR-9 | Container-runtime behavior: SIGTERM stops new requests and drains in-flight enqueues within one publish budget + slack, with the drain logged. Lambda has no drain; the platform stops the instance |

## Deployment target

AWS Lambda behind API Gateway, synchronous proxy integration — the same runtime shape document-parser already runs, chosen for operational sameness (one adapter image, one secrets plane, one IaC pattern for two front-door services). The survey recorded so the choice survives its authors:

| Runtime | Binding constraint | Verdict |
|---------|--------------------|---------|
| Lambda behind API Gateway | 6 MB synchronous invocation payload; 10 MB API GW body cap | viable — bodies are tiny here (1 MiB bound) |
| ALB → Lambda | 1 MB request body — hard limit | viable but unnecessary divergence |
| ECS Fargate behind ALB | no payload ceiling; long-lived process | viable; the fallback if the runtime ever needs standing connections |
| Lambda behind URL (no API GW) | no custom domain stitching with the rest of the stack | rejected for front-door consistency |

Operational notes:

- **Memory 512 MB (~0.3 vCPU)** — the work is HMAC over ≤ 1 MiB plus one SQS `SendMessage`; no CPU-hungry phase. The knob exists if p95 latency ever says otherwise.
- **Function timeout 10 s** — the in-code budget (5 s) must win the race against a platform timeout, which is an opaque 502 (NFR-3).
- **Lambda Web Adapter over the existing image** — the Go app, its config planes, and its tests stay unmodified; the same image serves local compose and Lambda.
- **API Gateway buffers the full request body** before invoking — the bounded read stays meaningful inside the service only. Accepted: at 1 MiB the platform-side buffering is bounded.
- **Cold starts** (Go binary, ~sub-second) are invisible against webhook budgets; accepted.
- **SQS reachability** — public endpoint via NAT, or a VPC endpoint; network path is provisioning-plane detail recorded with the IaC, not app config.
- The config plane resolves at boot; the prod Secrets Manager read adds ~100 ms to every cold start. Accepted.

## Numeric bounds

| Bound | Default | Failure behavior |
|-------|---------|------------------|
| Request body | 1 MiB | Reject with 413 naming the limit, before validation |
| In-code publish budget | 5 s | 503 with `Retry-After: 5`; enqueue attempt abandoned |
| SQS message retention (main) | 14 days | Queue-level setting (IaC), not app config |
| SQS message retention (DLQ) | 14 days | Dead events older than 14 days are lost — bounded alternative to RabbitMQ's "keep forever" DLQ, guarded by depth/age alarms (see [messaging.md](messaging.md)) |
| SQS visibility timeout | 300 s | Queue-level setting; must exceed the worker's maximum processing time |
| Redrive maxReceiveCount | 5 | After 5 receive attempts the event moves to the DLQ |
| SQS dedup window | 5 min | Fixed by AWS; beyond it Paddle duplicates re-reach the worker, whose idempotency layer remains the backstop |

HTTP bounds are configurable at boot via environment variables with these defaults and fail closed: an unset or invalid value falls back to the safe default. Queue-level bounds live in Terraform and change only with the [messaging.md](messaging.md) contract.

## Explicitly out of scope

- The `worker-payments` consumer swap to SQS — out of scope, tracked as a knock-on with the cutover order
- Any provider beyond Paddle; the internal-events face is not a provider seam
- Service-level dedup storage (Redis/DB) — SQS dedup plus worker idempotency covers it
- Rate limiting, admission control (429/503 on saturation) — shedding is not this service's lever
- DLQ inspection/replay tooling — AWS console + CLI is the accepted operational surface
- EventBridge or SNS in the delivery path — one consumer, no fanout, no rule routing ([messaging.md](messaging.md) records the survey)

## Knock-ons

Out of this build's phase-1 code, tracked here so the contract change is visible:

- **`worker-payments`** — new SQS consumer (`payment_events.fifo`), RabbitMQ consumer retires at cutover; its own pull request
- **Paddle dashboard** — webhook destination URL re-pointed to `<host>/api/v1/webhook/paddle`
- **`apps/web` `cancel-subscription.ts`** — header `X-Internal-Key: env.INTERNAL_API_KEY` → `x-api-key: env.PAYMENT_GATEWAY_API_KEY`; path → `/api/v1/internal/events`
- **`apps/web` env** — new caller-side name `PAYMENT_GATEWAY_API_KEY` per the document-parser `FILE_EXTRACTOR_API_KEY` precedent (the service side stays `API_KEY`); compose files re-wired in the same PR; the web's own `INTERNAL_API_KEY` (analyze-stream load-test bypass) is a different credential and is untouched
- **`apps/web` BFF status route** — `app/api/services/payment-gateway/status` polls `/readyz` → `/ready`
- **`apps/web` docs** — configuration/request-flows/services pages name the old path and header
- **Load rigs** — `apps/web/test/load/mock-server` fakes the old path; rig env files carry the internal key
- **Secrets tooling** — the gateway's Secrets Manager blob (`{"API_KEY": …}`) joins the seed process allowlist; `PADDLE_WEBHOOK_SECRET` rides the same mechanism
- **Queue provisioning** — Terraform creates the FIFO queue, FIFO DLQ, redrive policy, and CloudWatch alarms (see [messaging.md](messaging.md))

## Deferred

- **Load rig stress/soak/negative profiles** — deliberately postponed; the internal face of this service is low-volume, and Paddle's retry cadence cannot be load-rigged meaningfully against Lambda platform latency
- **`references/` LLDs** — drafted with the build, per [README.md](README.md)

## Open decisions (cleared before build starts)

- [x] Broker: **AWS SQS over RabbitMQ/Amazon MQ** — managed FIFO removes cluster operation and the entire connection lifecycle; the survey and the rejected alternatives live in [messaging.md](messaging.md)
- [x] Queue type: **FIFO** with per-category message groups and body-derived dedup — preserves the delivery-order semantics the untouched worker relies on; rationale in [messaging.md](messaging.md)
- [x] HTTP contract: endpoints, paths, request/response shape, status codes — resolved in [http.md](http.md)
- [x] Internal credential: **renamed to the document-parser scheme** — header `x-api-key`, env/secret `API_KEY`, constant-time compare; scheme in [Authentication scheme](#authentication-scheme)
- [x] Probes: `/health` and `/ready` at the root, open, kept for local parity — flat and version-free, a deliberate reverse of document-parser's versioned-everything shape
- [x] Deployment runtime: **Lambda + API Gateway**, container image via Lambda Web Adapter — decided by the runtime survey above for operational sameness with document-parser
- [x] Body bound: **1 MiB** (unchanged from the gateway it replaces); too-large answers 413, malformed answers 400 (the split document-parser standardized)

Resolved: the metric inventory point of continuity and the New Relic migration are recorded in [observability.md](observability.md).
