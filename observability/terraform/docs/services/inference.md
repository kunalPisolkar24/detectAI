# Inference Dashboard

This page documents the **detectai-inference** board: what it shows and which alerts page the team.

| | |
|---|---|
| Watches | `services/inference` — the gRPC model-serving service behind DetectAI's verdicts |
| Service name | `inference` |
| Board | `detectai-inference`, 1 page: Inference |
| Dev twin | **none** — the load rigs never run the AI service, so this board exists for prod only |
| Built from | `dashboards/inference/prod.tftpl` · `alerts/inference.tf` |

## How data gets here

- **Spans and logs** — pushed over OTLP through the collector (`deployment.environment = prod`).
- **Device metrics** — the GPU/host panels read the runtime's own gauges.

## Inference — one page, deep rather than wide

| Panel | What it tells you |
|-------|-------------------|
| gRPC QPS · gRPC error share | Traffic and failure share at a glance |
| Inference p95 · Latency by gRPC method | The fast path — and which method owns the slow tail |
| Queue drops | Batches rejected when the queue is full (usually `RESOURCE_EXHAUSTED`) |
| Batch efficiency | Whether requests are batching usefully |
| Errors by gRPC code | Which failure code dominates |
| Latency by model revision + provider | Which model version serves requests |
| Device + host | GPU utilization, memory and CPU — shows the bottleneck, not just the symptom |
| Chunk/token behaviour · Recent inference errors | Workload shape and the latest failures |

## Alerts

| Alert | Fires when | Why you care |
|-------|------------|--------------|
| **Inference error share high** | Span error share above 2% for 10 minutes | DetectAI's core feature is failing |
| **Inference queue drops** | Any queue-full or `RESOURCE_EXHAUSTED` log within 5 minutes | Requests are being shed under load |

Source: `alerts/inference.tf`. The queue-drop alert is log-based by design — a drop happens on the edge of saturation, exactly where you want noise to become a page.
