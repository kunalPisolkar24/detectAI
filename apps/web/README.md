# Detect AI Web Service

A Next.js 16 full-stack application that serves as the user-facing frontend for the Detect AI platform. It handles AI text detection, chat conversations, authentication, and subscription management.

## Documentation

**[Full Documentation →](docs/README.md)**

## Quick Start

### Prerequisites

- Node.js 20+ and pnpm
- Docker and Docker Compose

### Local Development

```bash
# Install dependencies
cd apps/web && pnpm install

# Copy the example env file
cp .env.example .env

# Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The app needs PostgreSQL, Redis and RabbitMQ. The quickest way to get them is
the Docker stack, which starts the web service alongside them:

```bash
cd apps/web
make start
```

The example `.env` points at the Docker Compose service names, so it works as
is with `make start`. If you run `pnpm dev` on your own machine instead,
change the service URLs in `.env` to `localhost` and set the ports the
services actually listen on.

### Preview Mode (No Backend Services)

```bash
cd apps/web
pnpm preview:build
pnpm preview:start
```

## What This Service Does

- **AI Text Detection** — Analyze text for AI-generated content with streaming results
- **Chat Interface** — Conversational UI for analyzing text snippets
- **Authentication** — Email/password, Google, and GitHub login via NextAuth
- **Rate Limiting** — A daily usage cap and an abuse limiter, both Redis-backed
- **Subscription Management** — Paddle.js integration for premium features

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| UI | React, Shadcn UI, Tailwind CSS |
| State | Zustand, TanStack Query |
| Auth | NextAuth.js (JWT strategy) |
| Database | PostgreSQL (Prisma ORM) |
| Cache | Redis (ioredis) |
| gRPC | @grpc/grpc-js |
| Metrics | prom-client (Prometheus) |
| Logging | pino |
| Tracing | OpenTelemetry |
| Testing | Vitest, Playwright, MSW, k6 |

## Project Structure

```
apps/web/
├── app/                  # Next.js App Router (routes & pages)
├── features/             # Domain-driven feature modules
├── lib/                  # Shared libraries
│   ├── config/           # Configuration
│   ├── domain/           # Domain types and schemas
│   └── infrastructure/   # External system connections
├── components/           # Shared UI components
├── proxy.ts              # Route protection and request logging
├── test/                 # Test utilities and the load-test rig
└── e2e/                  # E2E tests
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm preview:build` | Build in preview mode |
| `pnpm preview:start` | Start in preview mode |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run unit tests in watch mode |
| `pnpm test:run` | Run unit tests |
| `pnpm test:integration:backend` | Run backend integration tests |
| `pnpm test:integration:ha` | Run high-availability tests (needs Docker) |
| `pnpm test:e2e` | Run E2E tests |

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
│   ├── rate-limiting.md       # The two rate limiters
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
