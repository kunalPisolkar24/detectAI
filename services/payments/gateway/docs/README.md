# Gateway Docs

Deep dives for the `payment-gateway` service. Start with `01-architecture.md`.

| Guide | What | Key Diagram |
|---|---|---|
| [01-architecture](01-architecture.md) | High-level, sequence, DLQ, class view | `graph LR`, `classDiagram` |
| [02-validation](02-validation.md) | HMAC timestamp, `x-api-key`, error branches | `sequenceDiagram` |
| [03-internals](03-internals.md) | RabbitMQ adapter, publisher confirms, retry/DLQ, quorum | `graph TB` |
| [08-configuration](08-configuration.md) | Full env table and validation | — |
| [09-api](09-api.md) | Endpoints, status codes, examples | — |
| [10-observability](10-observability.md) | Metrics, alerts, PromQL | — |
| [11-testing](11-testing.md) | Unit, integration, load matrix | — |

Related:

* Main quickstart: [`../README.md`](../README.md)
* Load runner: [`../test/load/README.md`](../test/load/README.md)
* Compose: [`../infra/compose.yml`](../infra/compose.yml)
