# Detect AI Web Service

A Next.js 15 full-stack application that serves as the user-facing frontend for the Detect AI platform. It handles AI text detection, chat conversations, authentication, and subscription management.

## Documentation

**[Full Documentation →](docs/README.md)**

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### Local Development

```bash
# Start infrastructure (PostgreSQL + Redis)
docker compose -f infra/docker/data/compose.yml up -d

# Install dependencies
cd apps/web && npm install

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Preview Mode (No Backend Services)

```bash
cd apps/web
npm run preview:build
npm run preview:start
```

## What This Service Does

- **AI Text Detection** — Analyze text for AI-generated content with streaming results
- **Chat Interface** — Conversational UI for analyzing text snippets
- **Authentication** — Email/password, Google, and GitHub login via NextAuth
- **Rate Limiting** — Daily usage limits with Redis-backed tracking
- **Subscription Management** — Paddle.js integration for premium features

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) |
| UI | React, Shadcn UI, Tailwind CSS |
| State | Zustand, TanStack Query |
| Auth | NextAuth.js (JWT strategy) |
| Database | PostgreSQL (Prisma ORM) |
| Cache | Redis (ioredis) |
| gRPC | @grpc/grpc-js |
| Metrics | prom-client (Prometheus) |
| Logging | pino |
| Tracing | OpenTelemetry |
| Testing | Vitest, Playwright, MSW |

## Project Structure

```
apps/web/
├── app/                  # Next.js App Router (routes & pages)
├── features/             # Domain-driven feature modules
├── lib/                  # Shared libraries
│   ├── config/           # Configuration
│   ├── domain/           # Domain types
│   └── infrastructure/   # External system connections
├── components/           # Shared UI components
├── test/                 # Test utilities
└── e2e/                  # E2E tests
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run preview:build` | Build in preview mode |
| `npm run preview:start` | Start in preview mode |
| `npm run lint` | Run ESLint |
| `npm run test:run` | Run unit tests |
| `npm run test:integration:backend` | Run integration tests |
| `npm run test:e2e` | Run E2E tests |

## Documentation Structure

```
docs/
├── README.md                  # Documentation index
├── getting-started/
│   ├── quickstart.md          # Local development setup
│   └── configuration.md       # Environment variables
├── concepts/
│   ├── architecture.md        # System design
│   └── request-flows.md       # Request processing
├── components/
│   ├── api-routes.md          # API endpoints
│   ├── auth.md                # Authentication
│   ├── services.md            # Backend integrations
│   └── infrastructure.md      # Database, cache, tracing
├── operations/
│   ├── health.md              # Health checks
│   └── observability.md       # Metrics and logging
└── testing/
    └── overview.md            # Test structure
```

## License

MIT
