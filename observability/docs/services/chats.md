# Chats Dashboard

This page documents the **detectai-chats** board: what each page shows and which alerts page the team.

| | |
|---|---|
| Watches | `services/chats` — two roles on one board: `chat-service` (gRPC API) and `chat-worker` (stream consumer) |
| Service names | `chat-service`, `chat-worker` |
| Board | `detectai-chats`, 6 pages: Overview, Service, Service Logs, Worker, Worker Logs, Infra |
| Dev twin | yes — same pages, ` (dev)` on every title |
| Built from | `dashboards/chats/{prod,dev}.tftpl` · `alerts/chats.tf` |

## How data gets here

- **Traces and logs** — pushed over OTLP through the collector.
- **Metrics** — the collector scrapes the API and worker Prometheus endpoints (`:9091`, `:9099`).

## Overview — both roles in one look

| Panel | What it tells you |
|-------|-------------------|
| RPC/min · Error share | API load and failure share |
| RPC p95 / p99 (all ops) | User experience on the API |
| Redis degraded | The shared degraded flag — red here means both roles feel it |
| Publish vs ingest · Tail latency p95 by family | Message flow and the slowest operation families |
| Stream lag worst/avg + pending · Lag by partition | The worker's deficit, and where it sits |
| Cache hit ratio · Container CPU/memory per role | Cache value and runtime health |
| Service versions reporting | Which builds are live |

## Service — the gRPC API

| Panel | What it tells you |
|-------|-------------------|
| Reads / Writes / Updates-deletes p95 | Latency per operation family |
| Read/Write/Update-delete p99 by method | Which method owns the slow tail |
| Throughput by family · Slow RPC rate by family | Traffic mix and where it hurts |
| API error share · Requests by status · Errors by family/code | Failure shape |
| Published + sync fallback | Whether degraded-mode writes are being used |
| Message size avg | Workload shape |
| Slowest methods | Ranked worst RPCs |

## Service Logs

Same layout as every service page: error stream (latest 100), volume by level, errors by method, recent api errors, and slow RPCs over 500 ms.

## Worker — the stream consumer

| Panel | What it tells you |
|-------|-------------------|
| Ingested/min · Consumed/min | What arrived vs what got processed |
| DLQ messages · Stream pending | Backlog and permanent loss |
| Batch process vs BulkUpsert latency · Batch size avg | Pipeline efficiency per stage |
| Stream errors · DB errors by operation | Which layer is failing |
| Consumed vs ingested · Go runtime per role | Catch-up speed and runtime health |

## Worker Logs

Error stream (latest 100), volume by level, errors by message, recent worker errors, and slow BulkUpsert calls over 1000 ms.

## Infra — the datastores behind chat

| Panel | What it tells you |
|-------|-------------------|
| Mongo op p95 · Redis cmd p95 · Cache hit % | The three dependencies at a glance |
| Mongo/Redis p95 slowest 4 ops | Which specific call owns the tail |
| Cache read latency hit vs miss | The cost of a miss |
| Mongo/Redis container CPU/mem · Datastore network rx/tx | Container-level pressure |
| Redis exporter · Collector pipeline | Exporter health and delivery to New Relic |
| Slowest datastore ops | Ranked worst datastore calls |

## Alerts

| Alert | Fires when | Why you care |
|-------|------------|--------------|
| **Chats Redis degraded** | The `chat_redis_degraded` gauge equals 1 for 5 minutes | Both roles shift to degraded mode — writes sync to Mongo instead of the cache |

Source: `alerts/chats.tf` — a single gauge condition shared by `chat-service` and `chat-worker`, so both roles' view of the same degradation cannot disagree.
