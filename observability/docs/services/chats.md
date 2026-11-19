# Chats Dashboard

This page documents the **detectai-chats** board: what each page shows and which alert pages the team.

| | |
|---|---|
| Watches | `services/chats` — one ConnectRPC service, `chats` |
| Service names | `chats` |
| Board | `detectai-chats`, 2 pages: Chat Service, Logs |
| Dev twin | yes — same pages, ` (dev)` on every title, filters `deployment.environment = 'dev'` |
| Built from | `dashboards/chats/{prod,dev}.tftpl` · `alerts/chats.tf` |

## How data gets here

All three signals are pushed **directly from the service to New Relic EU** over OTLP/HTTP. There is no collector hop, no Prometheus endpoint and no exporter sidecar for this service — the app owns `service.name`, `service.version` and `deployment.environment` (`prod`/`dev`). See `services/chats/specification/observability.md` for the instrument inventory.

A panel only has data when the chats process boots with `OTEL_EXPORTER_OTLP_ENDPOINT` and `NEW_RELIC_LICENSE_KEY` set. Without the endpoint the service uses its null telemetry build and emits nothing — an empty board is an unconfigured service, not a broken board.

## Chat Service

| Panel | What it tells you |
|-------|-------------------|
| RPC/min · Error share | Load and failure share. Both come from ConnectRPC spans (`rpc.system = 'connect_rpc'`); procedure spans are internal spans, so they are **not** filtered on `span.kind`. |
| RPC p95 / p99 all ops | User latency, from span `duration.ms` |
| Avg RPC read / write latency | Full RPC average latency per group, un-faceted, from span `duration.ms` |
| Avg cache read / write latency | Full cache-operation average per group — `chats_cache_operation_duration_seconds` |
| Avg DB read / write latency · DB read / write ops/min | Mongo call cost and throughput per group — `chats_datastore_operation_duration_seconds`, `chats_datastore_operations_total` |
| RPC throughput / p95 / p99 by procedure (reads / writes) | Which method owns the traffic and the slow tail, split so read calls do not drown out writes |
| Cache operation latency (reads / writes) | Cost per cache operation, split by read and write operations |
| Datastore operation latency (reads / writes) | Mongo call cost, split by read and write operations |
| RPC errors by code | Which Connect code is failing (`not_found`, `resource_exhausted`, `internal`, …) |
| Cache operations by result | Hits, misses, absorbed faults and writes — `chats_cache_operations_total` |
| Datastore operations by result | Mongo outcomes, including `not_found`, `conflict`, `unavailable` — `chats_datastore_operations_total` |
| Rate-limit refusals by scope | Which burst budget (`create`/`write`) is exhausted |
| Validation rejections by field | Which payload field clients get wrong |
| Slowest RPCs | Ranked worst procedures by average and max latency |
| Service versions reporting | Which build is live |

The read/write split uses the values the service already emits: RPC reads are `GetChat`, `ListChats`, `GetChatHistory` and the other five procedures are writes; datastore reads are `chat`, `chats`, `chat_history` and writes include `rename_chat` (an update); cache reads are `chat`, `chat_list`, `head` and writes include the `put_*` and `invalidate_*` operations.

The cache, datastore, rate-limit and validation panels use instruments the service emits itself. They are deliberately on this page rather than an Infra page: there is no exporter to scrape and no datastores-side telemetry in this pipeline.

## Logs

| Panel | What it tells you |
|-------|-------------------|
| Error and warn stream | Latest 100 ERROR/WARN records with `trace.id`, so a line links into its trace |
| Log volume by level | Overall logging shape |
| Error and warn volume by message | Top repeated failure messages over time |
| Recent errors and warnings | Grouped samples with a trace link |
| Slow RPCs over 500ms | ConnectRPC spans that took longer than 500 ms |

The service emits no `method`, `code` or `stream` log fields; method and code live on spans and metrics, and `stream` belonged to the retired worker.

## Alerts

| Alert | Fires when | Why you care |
|-------|------------|--------------|
| **Chats RPC error share high** | More than 2% of ConnectRPC spans carry an error status for 10 minutes | The old `chat_redis_degraded` condition queried a metric the rebuilt service no longer emits; the replacement pages on a signal the service really produces. |

Source: `alerts/chats.tf` — one condition on the `chats` alert policy, filtered on `deployment.environment = '${var.environment}'` so a load-test run never pages.

## Later: EKS

Production is expected to move to EKS. There is no Kubernetes telemetry in the pipeline today, so no runtime page is published. When the cluster ships, add a third **prod-only** page — container CPU/throttling, memory vs limit, OOMKilled/restart counts, pod readiness and replica availability — once the telemetry path is chosen (New Relic Kubernetes integration or an OTel collector DaemonSet with kube-state-metrics/cAdvisor). It must stay out of the dev twin, and the twin-parity tests need a documented deviation for it, like the workers board's Payments swap.
