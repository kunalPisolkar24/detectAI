# Inference Service Documentation

Welcome to the Inference service documentation. This guide will help you understand how the AI detection service works and how to use it.

## New to This Service?

Start here:

1. **[Quick Start](getting-started/quickstart.md)** - Get the service running in minutes
2. **[Architecture](concepts/architecture.md)** - Learn how the service is structured
3. **[Configuration](getting-started/configuration.md)** - Set up the service for your environment

## Documentation by Topic

### Getting Started

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Quick Start](getting-started/quickstart.md) | Run the service locally and make your first call | You haven't got it running yet |
| [Configuration](getting-started/configuration.md) | Every env var, its default, and how dev/prod loading differs | You need to change a port, key, batch size or provider |

### Concepts

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Architecture](concepts/architecture.md) | The layering, the startup sequence, and why the code uses ports and adapters | You're new to the codebase |
| [Request Flows](concepts/request-flows.md) | What happens end to end for `Detect` and `AnalyzeDocument` | You're debugging a request or writing a client |
| [Chunking](concepts/chunking.md) | How text becomes chunks and how chunk scores become one score | Scores or highlight spans look wrong |
| [Batching](concepts/batching.md) | How individual predictions are grouped, and the queue/health rules | You're tuning throughput or latency |

### Components

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [API Reference](components/api.md) | RPC signatures, fields, status codes, copy-paste examples | Integrating with the service |
| [Authentication](components/auth.md) | API key vs JWT, what's checked, how failures are reported | You're hitting `UNAUTHENTICATED` |
| [Models](components/models.md) | Which models run, where they come from, how they're loaded | Model download/loading issues |
| [Health](components/health.md) | Health states, probes, Docker healthchecks, shutdown | Setting up or debugging probes |

### Operations

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Observability](operations/observability.md) | Metric names, log format, tracing, alert rules | Writing dashboards or alerts |

### Testing

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Testing Overview](testing/overview.md) | Unit vs integration vs load, and how to run each | Writing or running tests |

## Reading Order for Different Roles

### New Developers
1. [Quick Start](getting-started/quickstart.md) - Get it running
2. [Architecture](concepts/architecture.md) - Understand the big picture
3. [Request Flows](concepts/request-flows.md) - See how requests work
4. [Configuration](getting-started/configuration.md) - Set up your environment
5. [API Reference](components/api.md) - Learn the API

### DevOps/SRE
1. [Quick Start](getting-started/quickstart.md) - Get it running
2. [Configuration](getting-started/configuration.md) - Configure the service
3. [Health](components/health.md) - Set up monitoring
4. [Observability](operations/observability.md) - Configure metrics and alerts
5. [Architecture](concepts/architecture.md) - Understand the components

### Backend Developers
1. [API Reference](components/api.md) - Learn the API
2. [Request Flows](concepts/request-flows.md) - Understand the flow
3. [Authentication](components/auth.md) - Learn auth methods
4. [Testing Overview](testing/overview.md) - Write and run tests

## Related Files

- **Main README**: [`../README.md`](../README.md) - Overview and quick start
- **Makefile**: [`../Makefile`](../Makefile) - Build and test commands
- **Proto Definition**: [`../protos/ai_service.proto`](../protos/ai_service.proto) - API definition
- **Docker Compose**: [`../infra/compose.yml`](../infra/compose.yml) - Local development setup
- **Env template**: [`../infra/.env.example`](../infra/.env.example) - Canonical env vars with defaults
- **Load Tests**: [`../load/README.md`](../load/README.md) - Load testing guide

> All `make` targets in these documents run from `services/inference`, not the repo root.
