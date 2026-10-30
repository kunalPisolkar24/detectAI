# Overview Dashboard

This page documents the **detectai-overview** board: the golden-signals view across every service on one page.

| | |
|---|---|
| Watches | All services at once — the first page to open when you have no idea yet |
| Board | `detectai-overview`, 1 page: Golden signals |
| Dev twin | **none** — prod only |
| Built from | `dashboards/overview/prod.tftpl` |

## Golden signals — the one-page health check

| Panel | What it tells you |
|-------|-------------------|
| Total throughput (spans/min) | System-wide traffic |
| Global error share | Whether something is broken, before you know what |
| Global p95 duration | The overall slow tail |
| Collector export success | Whether the pipeline itself is healthy |
| Throughput / error share / p95 by service | Which service owns the signal |
| Log errors by service | A second, log-based way to catch service-specific pain |
| Per-service golden signals | The table version of the same story |
| Slowest server spans | The actual worst calls in the system right now |
| Recent error spans (trace links) | One click from symptom to trace |
| Pipeline rollup: MQ publish, cron ticks, reconcile lag | The asynchronous machinery in one glance |
| Service versions reporting | Which builds are live |

## How to use it

Start here when nothing is declared broken. If the global signal is dirty, the by-service lines tell you who; from there each service's own dashboard picks up the investigation — see the dashboard list in [the index](../README.md).

## Alerts

This board raises no alerts of its own — the per-service policies do the paging. The only cross-cutting condition lives next door: [Collector export failing](datastores.md), which pages when telemetry itself stops arriving.
