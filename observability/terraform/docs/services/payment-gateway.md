# Payment Gateway Dashboard

This page documents the **detectai-payment-gateway** board: what it shows and which alerts page the team.

| | |
|---|---|
| Watches | `services/payments/gateway` — the service that receives Paddle webhooks |
| Service name | `payment-gateway` |
| Board | `detectai-payment-gateway`, 2 pages: Payment gateway, Logs |
| Dev twin | yes — same pages, ` (dev)` on every title |
| Built from | `dashboards/payment-gateway/{prod,dev}.tftpl` · `alerts/gateway.tf` |

## How data gets here

- **Traces and logs** — pushed over OTLP through the collector.
- **Metrics** — broker and connection panels read `rabbitmq_connection_status`, which arrives via the collector's Prometheus scrape.

## Payment gateway — one page, end to end

| Panel | What it tells you |
|-------|-------------------|
| Webhooks/min · Error share | Arrival rate and failure share at a glance |
| Webhook p95 · Webhook p99 | The fast and the very slow tail |
| Server latency p50/p95/p99 by route | Route-level breakdown |
| Status codes | The 2xx/4xx/5xx split |
| Signature / validation failures | Paddle payloads that failed verification or parsing |
| Events published | Accepted webhooks that turned into broker events |
| MQ connection + publish latency · MQ connected | Whether the broker link is healthy and how long publishing takes |
| Go runtime · container CPU/memory/network/throttling | The process and its headroom |
| Slowest routes · Service versions reporting | Ranked worst routes; which builds are live |

## Logs

| Panel | What it tells you |
|-------|-------------------|
| Error log stream (latest 100) | Raw errors, newest first |
| Log volume by level | Health drift |
| Errors by message · Recent gateway errors | Which messages dominate |
| Slow requests over 500 ms | Requests whose spans outlasted the p95 |

## Alerts

| Alert | Fires when | Why you care |
|-------|------------|--------------|
| **Gateway 5xx share high** | 5xx share above 1% for 5 minutes | Paddle is getting error responses |
| **Gateway MQ publish failures** | Any `mq publish fail`-shaped log within 5 minutes | Accepted webhooks are not reaching the workers |

Source: `alerts/gateway.tf`. The publish-failure alert is log-based — it still fires even if the span data is fine, because a failed publish is a log event before it is anything else.
