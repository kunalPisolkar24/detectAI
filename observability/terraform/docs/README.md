# Observability Documentation

Welcome to the DetectAI observability documentation. This guide covers how New Relic dashboards and alerts are defined as code, deployed, and — most importantly — how to read them.

## New to the Observability?

Start here:

1. **[Quick Start](getting-started/quickstart.md)** — deploy every board and alert from a fresh checkout
2. **[Architecture](concepts/architecture.md)** — how telemetry reaches New Relic and what Terraform creates
3. **[Web Dashboard](services/web.md)** — a tour through one board, page by page

## Documentation by Topic

### Getting Started

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Quick Start](getting-started/quickstart.md) | Deploy boards + alerts for the first time | First deployment, new machine |
| [Configuration](getting-started/configuration.md) | `.env` keys, credential precedence, state planes | Setting up credentials |

### Concepts

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Architecture](concepts/architecture.md) | Data flow, Terraform structure, alert anatomy | Understanding the system |

### Dashboards — one page per board

| Dashboard | What You'll Learn | When to Read |
|-----------|-------------------|--------------|
| [Overview](services/overview.md) | Golden signals across every service on one page | "Is anything down?" |
| [Datastores](services/datastores.md) | Datastore latency and the collector pipeline | Everything looks slow |
| [Web](services/web.md) | `apps/web` charts and alerts | Something looks off in the app |
| [Payment Gateway](services/payment-gateway.md) | Paddle webhook health and MQ publishing | Webhook or broker problems |
| [Workers](services/workers.md) | The three background workers on one board | Jobs lag, retry or dead-letter |
| [Inference](services/inference.md) | The AI model-serving service | AI answers are slow or failing |
| [Document Parser](services/document-parser.md) | Upload and extraction pipeline | Uploads fail or extraction lags |
| [Chats](services/chats.md) | Chat API and chat worker together | Chat messages lag or Redis degrades |

## Project Structure

```
observability/
└── terraform/              the Terraform root (this component)
    ├── main.tf             wiring only: the two layers below
    ├── dashboards/         board layer — one wiring file per board
    ├── alerts/             alert layer — policies, conditions, email routing
    ├── modules/            building blocks: dashboard + alert-condition
    ├── envs/               .env templates (credentials, plane selection)
    ├── tools/newrelic.py   .env validator + terraform driver
    ├── mk/                 make fragments: offline tests + New Relic flows
    ├── tests/              mocked terraform tests (no key, no network)
    └── docs/               this documentation
```

## Quick Reference

```bash
# Offline — no key, no network needed
make env && make fmt init validate test

# Against New Relic
make check        # validate envs/.env, preview the plane, resolve the account live
make bootstrap    # create the state bucket for the selected plane (idempotent)
make plan         # terraform plan
make apply        # terraform apply (auto-approves on the emulator plane)
```

## Related Files

- **Entry point**: [`../README.md`](../README.md) — what this component is
- **CI gate**: [`../../../.github/workflows/observability.yaml`](../../../.github/workflows/observability.yaml) — runs the offline checks
