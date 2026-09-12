# Document Parser Documentation

Welcome to the Document Parser service documentation. This guide will help you understand how the service works and how to use it.

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
| [Extraction Strategies](concepts/extraction-strategies.md) | How PDF, DOCX, and TXT files are parsed | Understanding file processing |
| [Text Cleaning](concepts/text-cleaning.md) | How raw text is cleaned and normalized | Understanding output quality |

### Components

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [API Reference](components/api.md) | How to call the service | Integrating with other systems |
| [Validation](components/validation.md) | What inputs are accepted | Debugging validation errors |
| [Health Checks](components/health.md) | Health and readiness probes | Monitoring the service |

### Operations

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Observability](operations/observability.md) | Metrics, logs, alerts, and dashboards | Monitoring and debugging |

### Testing

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Testing Overview](testing/overview.md) | How to test the service | Writing or running tests |

## Reading Order for Different Roles

### New Developers
1. [Quick Start](getting-started/quickstart.md) - Get it running
2. [Architecture](concepts/architecture.md) - Understand the big picture
3. [Extraction Strategies](concepts/extraction-strategies.md) - See how files are parsed
4. [Configuration](getting-started/configuration.md) - Set up your environment
5. [API Reference](components/api.md) - Learn the API

### DevOps/SRE
1. [Quick Start](getting-started/quickstart.md) - Get it running
2. [Configuration](getting-started/configuration.md) - Configure the service
3. [Health Checks](components/health.md) - Set up monitoring
4. [Observability](operations/observability.md) - Configure metrics and alerts
5. [Architecture](concepts/architecture.md) - Understand the components

### Backend Developers
1. [API Reference](components/api.md) - Learn the API
2. [Extraction Strategies](concepts/extraction-strategies.md) - Understand file processing
3. [Validation](components/validation.md) - Learn validation rules
4. [Testing Overview](testing/overview.md) - Write and run tests

## Related Files

- **Main README**: [`../../README.md`](../../README.md) - Overview and quick start
- **Makefile**: [`../../Makefile`](../../Makefile) - Build and test commands
- **Docker Compose**: [`../../infra/compose.yml`](../../infra/compose.yml) - Local development setup
- **Load Tests**: [`../../load/README.md`](../../load/README.md) - Load testing guide
