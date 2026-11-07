# Web Dashboard

This page documents the **detectai-web** board: what each page shows and which alerts page the team.

| | |
|---|---|
| Watches | `apps/web` — the Next.js frontend and BFF |
| Service name | `web` |
| Board | `detectai-web`, 4 pages: Overview, Service, Service Logs, Infra |
| Dev twin | yes — same pages, ` (dev)` on every title |
| Built from | `dashboards/web/{prod,dev}.tftpl` · `alerts/web.tf` |

## How data gets here

- **Traces and logs** — pushed over OTLP through the collector.
- **Metrics** — the collector scrapes `frontend:3000/api/metrics` (both sides share a bearer token from `infra/docker/prod/.env`; change it in one place and re-seed, or the scrape 401s).
- **Logs** — the `Service Logs` page only exists because the app pushes logs over OTLP; stdout alone is not ingested.

## Overview — is the app up, fast, and mostly 2xx?

| Panel | What it tells you |
|-------|-------------------|
| Request rate | Traffic right now |
| Server error share | The share of requests that threw an exception |
| p95 latency | Where the slow tail sits |
| Satisfied requests (< 500 ms) | An Apdex-style take on user experience |
| Request rate by path | Which routes carry the traffic |
| Latency p50/p95/p99 | Whether the tail concentrates on specific paths |
| Responses by status code | The 2xx/4xx/5xx split |
| Failed responses by path | Where failures live, route by route |

## Service — routes and dependencies

| Panel | What it tells you |
|-------|-------------------|
| Requests by path · Slowest paths | Traffic mix and the ranked worst routes |
| Spark inference latency · Flare inference latency | AI calls, split into **two panels** because Spark (TF-IDF) sits roughly an order of magnitude under Flare (BERT) — a shared axis would flatten Flare's line |
| Auth failures (401/403) | Rejections upstream of business logic |
| Rate limit rejections | The limiter firing |
| Cache hit and miss | Whether the user cache is earning its keep |
| Analytics publish failures · Usage Redis errors and sync fallback | Whether the app's side-channels degraded |

## Service Logs — the paper trail

| Panel | What it tells you |
|-------|-------------------|
| Error log stream (latest 100) | Full-width raw errors, trace ids included |
| Log volume by level · Errors by message | Health drift and the messages that dominate it |
| Recent errors with trace links | One click from error to trace |
| Slow requests over 500 ms | Requests whose spans outlasted the p95 |

## Infra — the runtime and its dependencies

| Panel | What it tells you |
|-------|-------------------|
| Event loop lag, heap, resident memory, container CPU | Node runtime health |
| Postgres backends and locks · longest transaction | Database pressure from the round-trip view |
| Redis memory, evictions, keyspace, clients | Cache pressure |
| RabbitMQ queue depth and consumers | Broker backpressure |
| Exporter health | A blank exporter panel means the exporter, not the app |

## Alerts

| Alert | Fires when | Why you care |
|-------|------------|--------------|
| **Web 5xx share high** | Server-span error share above 2% for 5 minutes | Users are seeing errors |
| **Web p95 latency high** | p95 above 2 s for 10 minutes | The slow tail got fat |

Source: `alerts/web.tf` — both read server spans, which is why the load rig's 4xx scenarios do not page.
