# Inference Dashboard

This page documents the **detectai-inference** board: what each page shows and which alerts page the team.

| | |
|---|---|
| Watches | `services/inference` — the gRPC model-serving service behind DetectAI's verdicts |
| Service name | `inference` |
| Board | `detectai-inference`, 2 pages: Inference, Logs |
| Dev twin | yes — same pages, ` (dev)` on every title |
| Built from | `dashboards/inference/{prod,dev}.tftpl` · `alerts/inference.tf` |

## How data gets here

- **All three signals** — the service pushes spans, app metrics and logs over OTLP (`deployment.environment = prod`). The dev twin filters the same signals on `deployment.environment = dev`.
- **Service-emitted metrics only** — `inference_batch_size`, `inference_queue_depth`, `inference_inflight_chunks` and `inference_engine_duration_seconds` come from the app itself. There are no scraped exporter metrics: provider fallback fails the boot rather than degrading silently, so there is no GPU/host or fallback-rate panel.

## Inference — golden signals and per-model behaviour

| Panel | What it tells you |
|-------|-------------------|
| RPS/min · Error share | Traffic and failure share at a glance |
| p95 · p99 | The speed the user feels, in milliseconds |
| Request latency p50/p95/p99 | Full request latency, smoothed and gradiated |
| Spark latency · Flare latency | The same latency split per served model (`model.id`); empty when that model is not enabled |
| Failures by type | Which gRPC status code or error message dominates |
| In-flight documents & chunks | Live pressure at the admission gate and in the engine |
| Queue drops | Batches shed when a saturated model returns `RESOURCE_EXHAUSTED` |
| Batch efficiency | How full each engine call is versus the configured width |
| Engine forward-pass latency by model | Model compute time from the app histogram, faceted by `model` |
| Latency by model revision + provider | Which build and execution provider actually served the traffic |

## Logs

| Panel | What it tells you |
|-------|-------------------|
| Error log stream (latest 100) · Recent inference errors | Raw errors with a trace sample, newest first |
| Log volume by level | Health drift (click the legend to isolate) |
| Errors by type | Which message dominates the failures |
| Slow requests over 1500 ms | Requests whose spans outlasted the threshold |

Inference logs carry no `path`, `status_code` or `duration_ms`, so the logs page facets on `message` and the slow-request table reads from spans. The 1500 ms threshold is a starting point, not a contract.

## Alerts

| Alert | Fires when | Why you care |
|-------|------------|--------------|
| **Inference error share high** | Span error share above 2% for 10 minutes | DetectAI's core feature is failing |
| **Inference queue drops** | Any queue-full or `RESOURCE_EXHAUSTED` log within 5 minutes | Requests are being shed under load |

Source: `alerts/inference.tf`. The queue-drop alert is log-based by design — a drop happens on the edge of saturation, exactly where you want noise to become a page.
