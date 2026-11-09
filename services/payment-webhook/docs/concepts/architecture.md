# Architecture

This document explains how one Paddle delivery becomes a durable event on the payment-events queue. Read the [Quick Start](../getting-started/quickstart.md) first if nothing is running yet.

## What this service is

A stateless webhook gateway: Paddle signs a delivery, the service verifies it, and the body is forwarded byte-for-byte to SQS. There is no database, no cache, no connection to hold — every request is self-contained, and one instance holds no state another needs. Concurrency comes from running more instances, not from anything inside one.

## The module map

```
internal/
├── router/          the gin engine — the /api/v1 group, probes + the single ingress
├── handlers/        the paddle face: bounded read, verify, envelope gate, one publish
│                    the probes and the response rows (200/400/413/503/500)
├── validator/       ReadBounded · the Paddle HMAC verifier · CheckEnvelope
├── events/          ParseEvent: the one Paddle metadata walk
├── queue/           the Message contract · Shape + the group ladder · the budget · SQS adapter
├── config/          typed Config + Resolve · dev/prod planes · fail-fast
├── observability/   the OTel facade: the null build or push to New Relic
└── server/          serve until SIGTERM, drain in-flight requests
```

The layering is strict and inward-facing: `router` orchestrates, `handlers` owns statuses, `validator`/`events`/`queue` own the three real jobs — checking, parsing, transporting — and `config`/`observability` serve them all. Nothing inside `queue` knows about HTTP.

## What happens on one delivery

```mermaid
sequenceDiagram
    autonumber
    participant P as Paddle
    participant H as the paddle handler
    participant V as validator
    participant Q as queue service
    participant S as SQS

    P->>H: POST /api/v1/webhook/paddle<br/>Paddle-Signature: ts=…;h1=…
    H->>V: ReadBounded — up to the bound + 1 byte
    V-->>H: the bytes, or a typed verdict
    H-->>P: 413 / 400 on a read verdict
    H->>V: Verify(header, body) — HMAC, ±5 min
    H-->>P: 401 on any failure class
    H->>V: CheckEnvelope — the four core fields
    H-->>P: 422 naming the missing fields
    H->>Q: Publish(body) — one 5 s budget
    Q->>S: SendMessage — dedup id, group key, attributes
    S-->>Q: accepted
    H-->>P: 200 {"status":"queued"}
```

The handler never touches AWS types or crypto: it bounds input, asks the validator three ordered questions, and maps the answer onto one response. Every delivery takes exactly this path — there is no second lane for known types or small bodies.

Questions the map answers, page by page:

- **Who may call, and what can fail?** → the [HTTP reference](../reference/http-api.md)
- **What can get in?** → [Validation](validation.md)
- **Where do events go, and in what order?** → [Delivery](delivery.md)
- **What does the boot read?** → [Configuration](../getting-started/configuration.md)
- **Where do signals go?** → [Observability](observability.md)

## The runtime model: sequential, deliberately

There is **no executor, no worker pool, no connection machinery — anywhere**. The request path is strictly sequential: read → verify → gate → parse → enqueue → answer. Concurrency exists outside the process (Lambda instances, container replicas), never inside it.

- **The publish budget (5 s)** bounds every enqueue: `context.WithTimeout` wraps the one `SendMessage`, and a deadline maps to 503 with `Retry-After` at the budget's ceil. If SQS actually accepted the message before the deadline, the dedup id makes the ambiguity harmless ([Delivery](delivery.md)).
- **Health is a boot signal, not a runtime check.** `ready` means boot validation passed — config, credentials, queue URL. There is no broker connection to poll, so there is nothing to check at request time.

## The boot and shutdown lifecycle

```mermaid
graph LR
    START(["start: cmd/api"]) --> FLICK["resolve the plane flick"]
    FLICK --> LOAD["config.Load — the typed Config"]
    LOAD --> FAIL["boot fails fast:<br/>named ConfigError"]
    LOAD --> BIND["bind the SQS publisher<br/>boot observability"]
    BIND --> SERVE["router serves :PORT"]
    SERVE --> SIG["SIGINT/SIGTERM"]
    SIG --> DRAIN["stop accepting, drain<br/>in-flight within DRAIN_TIMEOUT<br/>(never under budget + slack)"]
    DRAIN --> EXIT(["end: exit with<br/>the drain logged"])
    FAIL --> EXIT
```

Nothing is re-resolved per request: the config, the publisher, and the observability build all exist before the router serves anything, and on SIGTERM the drain guarantees in-flight enqueues finish inside the budget before exit.

## The deployment front door

AWS Lambda behind API Gateway, synchronous proxy integration — the same container image the local runtime uses, fronted by the Lambda Web Adapter, so the app, its config planes, and its tests stay unmodified across runtimes. The door shapes the numbers:

| Knob | Value | Why |
|------|-------|-----|
| Memory | 512 MB | constant-time HMAC over ≤ 256 KiB plus one `SendMessage` — no CPU-hungry phase |
| Function timeout | 10 s | above the 5 s budget, so the shaped 503 wins the race (a platform timeout would be an opaque 502) |
| API GW integration timeout | ≤ 29 s | above both; far under Lambda's 6 MB invocation ceiling at this service's body sizes |
| Cold starts | sub-second go binary + ~100 ms secrets fetch | invisible against webhook budgets; accepted |

## Canned probes

| Path | Healthy answer |
|------|----------------|
| `GET /api/v1/health` | 200 `{"status":"ok"}` |
| `GET /api/v1/ready` | 200 `{"status":"ready"}` |

Both are open endpoints and stay identical across runtimes, so callers can rely on them. Lambda has no probes — the platform owns availability — and they stay in the contract for local parity.
