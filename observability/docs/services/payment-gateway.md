# Payment Gateway Dashboard

This page documents the **detectai-payment-webhook** board: what it shows and which alerts page the team.

| | |
|---|---|
| Watches | `services/payment-webhook` — the service that receives Paddle webhooks |
| Service name | `payment-webhook` |
| Board | `detectai-payment-webhook` (prod / floci), 2 pages: Payment webhook, Logs |
| Dev twin | yes — same pages, ` (dev)` on every title |
| Built from | `dashboards/payment-webhook/{prod,dev}.tftpl` · `alerts/gateway.tf` |

## How data gets here

- **Traces, metrics, and logs** — the app's own OTel SDK pushes all three signals straight to New Relic EU over OTLP (the direct-push path document-parser established for Lambda): no collector hop, and the app stamps `deployment.environment` itself.

## Payment webhook — one page, end to end

| Panel | What it tells you |
|-------|-------------------|
| Webhooks/min · Error share | Arrival rate and failure share at a glance |
| Webhook p95 · Webhook p99 | The fast and the very slow tail |
| SQS enqueue errors/min · SQS enqueue latency | Enqueue failures creeping in; how long a successful SQS send takes |
| Server latency p50/p95/p99 by route | Route-level breakdown |
| Status codes | The 2xx/4xx/5xx split over time |
| Signature / validation failures | Paddle payloads that failed verification or parsing |
| Events published | Accepted webhooks that turned into SQS messages, split by outcome |
| Slowest routes · Service versions reporting | Ranked worst routes; which builds are live |

## Logs

| Panel | What it tells you |
|-------|-------------------|
| Error log stream (latest 100) | Raw errors, newest first |
| Log volume by level | Health drift |
| Errors by message · Recent webhook errors | Which messages dominate |
| Slow requests over 500 ms | Requests whose spans outlasted the p95 |

## Alerts

| Alert | Fires when | Why you care |
|-------|------------|--------------|
| **Gateway 5xx share high** | 5xx share above 1% for 5 minutes | Paddle is getting error responses |
| **Gateway MQ publish failures** | Any `mq publish fail`-shaped log within 5 minutes | Accepted webhooks are not reaching the workers |

Source: `alerts/gateway.tf`. The publish-failure alert is log-based — it still fires even if the span data is fine, because a failed publish is a log event before it is anything else.
