# Infrastructure Documentation

Welcome to the DetectAI infrastructure documentation. This guide covers everything you need to know about running, deploying, and managing the infrastructure that powers DetectAI.

## New to the Infrastructure?

Start here:

1. **[Quick Start](getting-started/quickstart.md)** - Get the full stack running locally in 5 minutes
2. **[Architecture](concepts/architecture.md)** - Understand the big picture
3. **[Configuration](getting-started/configuration.md)** - Set up your environment

## Documentation by Topic

### Getting Started

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Quick Start](getting-started/quickstart.md) | Run the full stack locally | First time using the infrastructure |
| [Configuration](getting-started/configuration.md) | All environment variables and settings | Setting up your environment |

### Concepts

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Architecture](concepts/architecture.md) | How everything fits together | Understanding the system |
| [Docker Compose](concepts/docker-compose.md) | How compose stacks, atoms, and overlays work | Working with Docker |
| [Terraform](concepts/terraform.md) | How infrastructure as code works | Working with AWS/emulator |

### Components

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Datastores](components/datastores.md) | Postgres, MongoDB, Redis, RabbitMQ details | Debugging datastore issues |
| [Standalone Atoms](components/standalone-atoms.md) | The reusable compose atom pattern | Creating new compose stacks |
| [Environment](components/environment.md) | .env files, variable precedence | Configuring environments |

### Operations

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Secrets](operations/secrets.md) | How secrets are managed | Debugging secret issues |
| [CI/CD](operations/ci-cd.md) | GitHub Actions pipelines | Understanding deployments |
| [Troubleshooting](operations/troubleshooting.md) | Common issues and fixes | Something isn't working |

## Reading Order for Different Roles

### New Developers
1. [Quick Start](getting-started/quickstart.md) - Get it running
2. [Architecture](concepts/architecture.md) - Understand the big picture
3. [Datastores](components/datastores.md) - Learn what stores what
4. [Configuration](getting-started/configuration.md) - Set up your environment

### DevOps/SRE
1. [Architecture](concepts/architecture.md) - System overview
2. [Terraform](concepts/terraform.md) - Infrastructure as code
3. [Secrets](operations/secrets.md) - Secret management
4. [CI/CD](operations/ci-cd.md) - Pipeline details
5. [Troubleshooting](operations/troubleshooting.md) - Common issues

### Backend Developers
1. [Datastores](components/datastores.md) - What stores what
2. [Configuration](getting-started/configuration.md) - Environment variables
3. [Environment](components/environment.md) - How .env files work

## Project Structure

```
infra/
├── docs/                    # This documentation
├── docker/
│   ├── local/               # Full local dev stack
│   ├── prod/                # Production stack (app services only)
│   ├── postgres-users/      # PostgreSQL atom
│   ├── redis-users/         # Redis for users atom
│   ├── redis-chat/          # Redis for chats atom
│   ├── redis-events/        # Redis for payments atom
│   ├── mongo-chat/          # MongoDB atom
│   ├── rabbitmq/            # RabbitMQ atom
│   └── data/                # Bundle: postgres + redis-users
└── terraform/
    ├── modules/             # Reusable Terraform modules
    │   ├── postgres/        # RDS Aurora PostgreSQL
    │   ├── docdb/           # Amazon DocumentDB
    │   ├── elasticache/     # ElastiCache Redis
    │   └── mq/              # Amazon MQ RabbitMQ
    ├── envs/                # Environment-specific variables
    └── tests/               # Terraform tests
```

## Quick Reference

### Local Development Ports

| Service | Port | Protocol |
|---------|------|----------|
| Web (Next.js) | 3000 | HTTP |
| Payment Gateway | 8080 | HTTP |
| Document Parser | 8000 | HTTP |
| AI Inference | 50051 | gRPC |
| AI Inference Metrics | 8333 | HTTP |
| Chat API | 50052 | gRPC |
| Chat API Metrics | 9095 | HTTP |
| Chat Worker Metrics | 9099 | HTTP |
| Worker Analytics | 7001 | HTTP |
| Worker Cron | 7002 | HTTP |
| Worker Payments | 7003 | HTTP |
| PostgreSQL | 5432 | TCP |
| Redis Users | 6379 | TCP |
| Redis Chat | 6381 | TCP |
| Redis Events | 6382 | TCP |
| MongoDB | 27018 | TCP |
| RabbitMQ | 5672 | AMQP |
| RabbitMQ UI | 15672 | HTTP |

### Makefile Commands

```bash
# Local development
make local-up          # Start local stack
make local-down        # Stop local stack
make local-logs        # View logs

# Production
make prod-up           # Start prod stack
make prod-down         # Stop prod stack

# Terraform
make tf-apply-local    # Apply Terraform locally
make tf-plan-local     # Plan Terraform locally

# Secrets
make seed-floci        # Seed secrets to emulator
make floci-verify      # Verify emulator state
```

## Related Files

- **Root Makefile**: [`../../Makefile`](../../Makefile) - All build and run commands
- **Root README**: [`../../README.md`](../../README.md) - Project overview
- **Terraform README**: [`../terraform/README.md`](../terraform/README.md) - Terraform-specific docs
