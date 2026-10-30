# Workers Dashboard

This page documents the **detectai-workers** board: what each page shows and which alerts page the team.

| | |
|---|---|
| Watches | `services/workers` — three deployables in one board: `worker-analytics`, `worker-cron`, `worker-payments` |
| Service names | `worker-analytics`, `worker-cron`, `worker-payments` |
| Board | `detectai-workers`, 8 pages: Overview + one page and one Logs page per worker + Infra |
| Dev twin | yes — same pages, ` (dev)` on every title |
| Built from | `dashboards/workers/{prod,dev}.tftpl` · `alerts/workers.tf` |

## How data gets here

- **Traces and logs** — pushed over OTLP through the collector.
- **Worker metrics** — the collector scrapes each worker's Prometheus endpoint (`:7001`, `:7002`, `:7003`).
- **Infra metrics** — the collector also scrapes the postgres, redis and rabbitmq exporters, whose panels sit on Infra.

## Overview — cross-worker rollup

| Panel | What it tells you |
|-------|-------------------|
| Messages/min (all workers) | Total throughput |
| Error share (all workers) | Any worker straining |
| Dead-lettered (total) · Retries/min | Failure volume in motion |
| RabbitMQ connected (min across workers) | The worst broker link |
| Cron expiry lag (s) · Expired backlog | How far the cron sweeper trails |
| Throughput by worker · Errors by worker | Who is busy, who is hurting |
| Job duration p50/p95/p99 (all workers) | Latency across every job type |
| Broker and cache connectivity | The wiring behind the work |
| Duplicate events filtered/min | Idempotency at work |

## Analytics — image/document analytics jobs

| Panel | What it tells you |
|-------|-------------------|
| Messages/min · Job p95 | Load and latency |
| Throughput and duplicates · Cache hit rate (dedup lookups) | How much work idempotency saved |
| Errors by type · Errors by type and job | What is failing and where |
| Redis and RabbitMQ connectivity · Active jobs and instances | Dependencies and capacity |
| Worker container CPU/memory/network/throttling, eventloop lag, heap | Node runtime per worker |

## Cron — subscription expiry sweeper

| Panel | What it tells you |
|-------|-------------------|
| Sweep ticks/min · Expired backlog · Expiry lag (s) | Sweeper rhythm and how far behind reality it runs |
| Sweep duration p50/p95/p99 · Batch size and expiry lag | Whether sweeps keep up |
| Subscription status distribution | The state of the world it sees |
| Sweep skips and shutdown aborts | Races it lost on purpose |
| Cache invalidation duration · retries | Post-sweep cleanup cost |

## Payments — subscription event handling

| Panel | What it tells you |
|-------|-------------------|
| Messages/min · Job p95 · Dead-lettered (total) | Load, latency and DLQ growth |
| Throughput and requeues | Working set and DB-down requeue pressure |
| Errors by type · Dead letters and errors by type | Failure taxonomy |
| **Paddle API latency and cancels** | Real Paddle round-trips — **prod-only**; the dev twin swaps it for `Cancel events/min` because only a user-initiated cancellation creates that data |
| Idempotency and connectivity · eventloop lag, heap | Cache behaviour and runtime health |

## Logs — one Logs page per worker

Analytics, Cron and Payments each share the same log layout: a warning-and-error stream (latest 100), volume by level (click the legend to isolate), errors by message, recent messages with trace links, and the slow-jobs table — 1000 ms for jobs on Analytics, 2000 ms on Payments, plus Sweep messages on Cron.

## Infra — the four datastores behind every worker

| Panel | What it tells you |
|-------|-------------------|
| Postgres pool waiting/connections, sweep transactions, requeues, sweep skips | Connection pressure and sweeper health |
| Postgres backends, locks, longest transaction (exporter) | Broker-side database view |
| Redis connectivity/memory/evictions/keyspace by instance | Cache health per instance |
| RabbitMQ reconnects, consume duration, dead-letter rate, queue depth, consumers | Broker health and backpressure |
| Dependency health by worker · RabbitMQ queue inventory | One table to spot which worker lacks which dependency |

## Alerts

| Alert | Fires when | Why you care |
|-------|------------|--------------|
| **Worker error share high** | Any worker's span error share above 2% for 10 minutes | Jobs are failing in bulk |
| **Cron expiry lag high** | Oldest expired subscription waited over 30 minutes (2× the 15-minute sweep interval), for 15 minutes | A stalled sweeper |
| **Workers dead-lettering messages** | Any DLQ enqueue within 5 minutes | Messages are being permanently lost |
| **Workers disconnected from RabbitMQ** | `rabbitmq_connection_status` below 1 (the worst consumer) for 2 minutes | Consumers cannot make progress |

Source: `alerts/workers.tf`. The connectivity gauge is **static-filled with 1** so a quiet scrape window reads as connected rather than hiding the pause — a missing series goes quiet instead of paging, which is why the fill mirrors the healthy value.
