# Chats Docs

Deep dives for the `chats` service. Start with `01-architecture.md` for the big picture.

| Guide | What | Key Diagram |
|---|---|---|
| [01-architecture](01-architecture.md) | Dual-role api/worker, hexagonal ports, startup DAG, class view | `graph LR`, `classDiagram` |
| [02-request-flows](02-request-flows.md) | `CreateChat` sync vs `SaveMessage` async stream, `GetHistory` hot/cold, error branches | `sequenceDiagram` |
| [03-validation](03-validation.md) | `x-user-id` auth, title/content/role/page limits, error branches | `sequenceDiagram` |
| [04-caching](04-caching.md) | `chat:{id}:hot` ZSET, Lua dedup, merge, populate | `graph TB`, `classDiagram` |
| [05-streaming](05-streaming.md) | `crc32` partitions, `global:ingest:{p}`, XGroup/XAck | `graph TB`, `sequenceDiagram` |
| [06-worker](06-worker.md) | Consumer per-partition loop, `ProcessBatch`, DLQ, recovery | `graph TB`, `sequenceDiagram` |
| [07-health](07-health.md) | Mongo/redis ping ticker, gRPC health, compose healthchecks | `graph TB` |
| [08-configuration](08-configuration.md) | Full env table and validation rules | — |
| [09-api](09-api.md) | Full proto, methods, status codes, validation notes | — |
| [10-observability](10-observability.md) | All metrics, dashboards, alerts, PromQL | — |
| [11-testing](11-testing.md) | Unit, integration, load matrix | — |

Related:

* Main quickstart: [`../Makefile`](../Makefile)
* Load runner: [`../tests/load/README.md`](../tests/load/README.md)
* Proto: [`../api/proto/chat_service.proto`](../api/proto/chat_service.proto)
* Compose: [`../infra/compose.yml`](../infra/compose.yml)
* Load compose: [`../infra/compose.load.yml`](../infra/compose.load.yml)
