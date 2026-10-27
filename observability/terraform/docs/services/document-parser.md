# Document Parser Dashboard

This page documents the **detectai-document-parser** board: what each page shows and which alerts page the team.

| | |
|---|---|
| Watches | `services/document-parser` — the FastAPI service that extracts text from uploads |
| Service name | `document-parser` |
| Board | `detectai-document-parser`, 2 pages: Document parser, Logs |
| Dev twin | yes — same pages, ` (dev)` on every title |
| Built from | `dashboards/document-parser/{prod,dev}.tftpl` · `alerts/parser.tf` |

## How data gets here

- **All three signals directly** — this service pushes traces, metrics and logs straight to the EU endpoint. It is the repository's reference pattern for observability wiring (`app/observability/`), which is why it alone needs no collector for its own panels.

## Document parser — one page, the whole pipeline

| Panel | What it tells you |
|-------|-------------------|
| Uploads/min · Error share | Traffic and failure share at a glance |
| Extract p95 · Extract p99 · Timeouts | The speed the user feels |
| Server latency p50/p95/p99 | Full request latency, not just extraction |
| Extraction duration — pdf / docx / txt | Workload split by mime type |
| Worker pool utilization % | Extraction capacity headroom |
| Queue depth + in-flight · Queue wait avg by mime | Backlog growing before saturation |
| Extraction failures by type · Rejections and timeouts | What fails, and whether it is the document's fault |
| Status codes · Slowest extractions | The raw outcome mix and ranked worst commits |
| Parser container CPU/memory/network/throttled | Container health and throttling |
| Service versions reporting | Which build is live |

## Logs

| Panel | What it tells you |
|-------|-------------------|
| Error log stream (latest 100) · Recent parser errors | Raw errors, newest first |
| Log volume by level | Health drift (click the legend to isolate) |
| Errors by path | Which endpoint dominates the failures |
| Slow requests over 1500 ms | Requests whose spans outlasted the p95 |

## Alerts

| Alert | Fires when | Why you care |
|-------|------------|--------------|
| **Parser error share high** | Server-span error share above 2% for 10 minutes | Uploads are failing in bulk |
| **Parser p95 latency high** | Warning above 2 s (10 min), **critical above 3 s (5 min)** on the extract route | Extraction got slow |
| **Parser extraction failures** | More than 5 failed extraction spans within 5 minutes | Corrupt or unsupported documents are piling up |
| **Parser queue saturated** | Average pool queue depth above 40 for 5 minutes (warning only) | Near `READINESS_MAX_QUEUE_DEPTH` (default 50) — anything high would drop uploads |
| **Parser rejections spike** | More than 10 rejected uploads/min for 5 minutes | Usually a size or type policy hitting users |

Source: `alerts/parser.tf` — five conditions, two of which are warning-level early signals (p95 warning, queue saturation).
