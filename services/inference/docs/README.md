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
| [Quick Start](getting-started/quickstart.md) | Run the service locally | First time using the service |
| [Configuration](getting-started/configuration.md) | All settings and how to configure them | Setting up the service |

### Concepts

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Architecture](concepts/architecture.md) | How the service is built and why | Understanding the system |
| [Request Flows](concepts/request-flows.md) | How requests move through the system | Understanding the flow |
| [Chunking](concepts/chunking.md) | How text is split into chunks for analysis | Understanding text processing |
| [Batching](concepts/batching.md) | How requests are batched for efficiency | Understanding performance |

### Components

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [API Reference](components/api.md) | How to call the service | Integrating with other systems |
| [Authentication](components/auth.md) | How authentication works | Securing your requests |
| [Models](components/models.md) | How ML models are loaded and used | Understanding detection models |
| [Health](components/health.md) | Health checks and monitoring | Monitoring the service |

### Operations

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Observability](operations/observability.md) | Metrics, logs, and alerts | Monitoring and debugging |

### Testing

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Testing Overview](testing/overview.md) | How to test the service | Writing or running tests |

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

- **Main README**: [`../../README.md`](../../README.md) - Overview and quick start
- **Makefile**: [`../../Makefile`](../../Makefile) - Build and test commands
- **Proto Definition**: [`../../protos/ai_service.proto`](../../protos/ai_service.proto) - API definition
- **Docker Compose**: [`../../infra/compose.yml`](../../infra/compose.yml) - Local development setup
- **Load Tests**: [`../../load/README.md`](../../load/README.md) - Load testing guide
