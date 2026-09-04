# Inference Docs

Deep dives for the `inference` service. Start with `01-architecture.md` for the big picture.

| Guide | What | Key Diagram |
|---|---|---|
| [01-architecture](01-architecture.md) | High-level graph, hexagonal ports, startup DAG, class view | `graph LR`, `classDiagram` |
| [02-request-flows](02-request-flows.md) | `Detect` unary and `AnalyzeDocument` streaming, error branches | `sequenceDiagram` |
| [03-auth](03-auth.md) | `x-api-key` vs `Bearer` JWT, health bypass, failure metrics | `sequenceDiagram` |
| [04-chunking](04-chunking.md) | Tokenizers, sliding window, highlight aggregation | `graph TB`, `classDiagram` |
| [05-batching](05-batching.md) | `BatchingProxy` queue/worker/semaphore/shutdown | `graph TB`, `classDiagram` |
| [06-models](06-models.md) | HF download, retries, `RestrictedUnpickler`, provider fallback | `sequenceDiagram` |
| [07-health](07-health.md) | Watchtower, `SERVING` vs `QUEUE_FULL`, metrics | `graph TB` |
| [08-configuration](08-configuration.md) | Full env table and validation rules | — |
| [09-api](09-api.md) | Full proto, endpoints, status codes, validation notes | — |
| [10-observability](10-observability.md) | All metrics, dashboards, alerts, PromQL | — |
| [11-testing](11-testing.md) | Unit, integration, load matrix | — |

Related:

* Main quickstart: [`../README.md`](../README.md)
* Load runner: [`../load/README.md`](../load/README.md)
* Proto: [`../protos/ai_service.proto`](../protos/ai_service.proto)
* Compose: [`../infra/compose.yml`](../infra/compose.yml)
