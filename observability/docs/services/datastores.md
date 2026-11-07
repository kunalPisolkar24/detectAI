# Datastores Dashboard

This page documents the **detectai-datastores** board: datastore health as seen from the services that use them, plus the health of the pipeline that ships telemetry to New Relic.

| | |
|---|---|
| Watches | Postgres, Redis, MongoDB, RabbitMQ — and the OTLP collector itself |
| Board | `detectai-datastores`, 1 page: Datastores + pipeline |
| Dev twin | **none** — prod only |
| Built from | `dashboards/datastores/prod.tftpl` |

## Datastores + pipeline — one page, both views

| Panel | What it tells you |
|-------|-------------------|
| PG / Redis / Mongo p95 (client spans) | Latency as the *services* experience the round trip — app-side truth, not server-side deep-dives |
| MQ publish errors | Failures handing messages to RabbitMQ |
| DB latency by caller service | Which service feels datastore latency first |
| Exporter: PG connections + cache hit (Floci) | The server-side view via the postgres exporter |
| Exporter: Redis per group (Floci) | Per-instance server-side view |
| Exporter: MQ queues (Floci) | Broker-side queue inventory |
| Collector pipeline (OTLP EU) | Spans/logs leaving for New Relic |
| Collector queue + memory | Backpressure in the collector — a growing queue here turns into missing data everywhere |

## A deliberate split: app-side vs exporter-side

- **Client-span panels** answer "how slow does the database feel?" — they come from the traces services emit about their own datastore calls.
- **Exporter panels** answer "what is the database server actually doing?" — they come from the exporter sidecars in the prod stack (`profiles: [floci]` infra exporters).

Compare the two when debugging: a client panel that degrades while the exporter panels stay calm puts the suspicion on the app, not the database.

## A note on the prod gap

The exporter panels are labelled for the emulator-based stack; on real AWS they fill from CloudWatch **after** the AWS account link is in place (a tracked follow-up). Until then, prod reads exporter data only from the Floci path.

## Alerts

| Alert | Fires when | Why you care |
|-------|------------|--------------|
| **Collector export failing** | Any failed OTLP export batch within 5 minutes | Telemetry itself is not arriving — boards go dark before services do |

Source: `alerts/pipeline.tf`. This is the only cross-service condition, because the collector is the only shared dependency every board's data flows through.
