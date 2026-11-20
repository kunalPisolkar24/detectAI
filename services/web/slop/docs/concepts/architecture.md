# Architecture

This document explains how the Web service is structured and why it's designed this way.

## Overview

The Web service is a **Next.js 16 full-stack application** that serves as the user-facing frontend and the backend-for-frontend (BFF). It handles UI rendering, API orchestration, authentication, and connects to all backend microservices.

```mermaid
graph TB
    subgraph "Web Service (Next.js)"
        UI[React UI<br/>App Router]
        Proxy[Proxy<br/>Route Protection]
        API[API Routes<br/>Server-side]
        BFF[Backend-for-Frontend<br/>Service Adapters]
    end

    subgraph "Backend Services"
        Chats[Chats Service<br/>gRPC]
        Inference[Inference Service<br/>gRPC]
        DocParser[Document Parser<br/>HTTP]
        Payments[Payment Gateway<br/>HTTP]
    end

    subgraph "Data Stores"
        PG[(PostgreSQL)]
        Redis[(Redis)]
        RabbitMQ[RabbitMQ]
    end

    UI --> Proxy
    Proxy --> API
    API --> BFF
    BFF --> Chats
    BFF --> Inference
    BFF --> DocParser
    BFF --> Payments
    BFF --> PG
    BFF --> Redis
    BFF --> RabbitMQ
```

**Why this design?**
- **Single deployment** — One app serves both UI and API, simplifying operations
- **Server-side rendering** — Next.js renders pages on the server for fast initial loads
- **BFF pattern** — Backend adapters translate between the frontend's needs and the microservices' protocols

## How the Code is Organized

The service uses a **feature-based architecture** where related code (components, hooks, services, tests) lives together under `features/`. Shared infrastructure lives in `lib/`.

```mermaid
graph TB
    subgraph "Presentation Layer"
        App[app/<br/>Routes & Pages]
        Components[components/<br/>Shared UI]
        Providers[providers/<br/>React Context]
    end

    subgraph "Feature Layer"
        Auth[features/auth/<br/>Authentication]
        Chat[features/chat/<br/>Chat & Analysis]
        Landing[features/landing/<br/>Landing Page]
        Profile[features/profile/<br/>Profile & Billing]
        Upgrade[features/upgrade/<br/>Subscriptions]
    end

    subgraph "Application Layer"
        AppLib[lib/application/<br/>Business Logic]
        Domain[lib/domain/<br/>Types & Interfaces]
        Config[lib/config/<br/>Configuration]
    end

    subgraph "Infrastructure Layer"
        Infra[lib/infrastructure/<br/>DB, Cache, gRPC, Logging]
        Services[lib/services/<br/>Cache and Lock]
        Shared[lib/shared/<br/>Generated Code, Proto]
    end

    App --> Components
    App --> Providers
    Components --> Feature
    Feature --> AppLib
    AppLib --> Domain
    Feature --> Infra
    AppLib --> Infra
    Config --> Infra
```

**Why feature-based?**
- Easy to find related code (all chat logic is in `features/chat/`)
- Clear boundaries between features
- Tests live next to the code they test

## Project Structure

```
apps/web/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Authentication pages (login, signup)
│   ├── (landing)/                # Landing page and its sub-pages
│   ├── (main)/                   # Main app layout (chat, profile)
│   ├── api/                      # API routes (server-side)
│   │   ├── auth/                 # NextAuth API routes
│   │   ├── chat/analyze/stream/  # Streaming AI analysis endpoint
│   │   ├── healthz/              # Liveness probe
│   │   ├── metrics/              # Prometheus metrics
│   │   ├── readyz/               # Readiness probe
│   │   └── services/             # Health proxies for backend services
│   ├── upgrade/                  # Subscription upgrade page
│   └── layout.tsx                # Root layout (providers, theme)
│
├── features/                     # Domain-driven feature modules
│   ├── auth/                     # Authentication (actions, components, hooks, services)
│   ├── chat/                     # Chat & AI analysis (components, hooks, services, stores)
│   ├── landing/                  # Landing page
│   ├── preview/                  # Preview mode (mock data)
│   ├── profile/                  # User profile and billing
│   ├── rate-limit/               # Rate limiter re-exports
│   ├── tracing/                  # OpenTelemetry tracing
│   └── upgrade/                  # Subscription upgrade
│
├── lib/                          # Shared libraries
│   ├── application/              # Business logic (rate limiting, user service)
│   ├── config/                   # Configuration (env, auth, AWS, preview)
│   ├── core/                     # Core utilities (fonts, serialization)
│   ├── domain/                   # Domain types, interfaces and schemas
│   │   └── schemas/              # Zod request schemas (auth, chat, profile)
│   ├── infrastructure/           # External system connections
│   │   ├── analytics-publisher.ts # RabbitMQ usage events
│   │   ├── grpc-client.ts        # gRPC client for the inference service
│   │   ├── grpc-loader.ts        # Proto file loader
│   │   ├── logger.ts             # Pino logger with trace context
│   │   ├── logging/              # OTLP log sink and pino hook
│   │   ├── metrics.ts            # Prometheus metrics
│   │   ├── prisma.ts             # Prisma ORM client
│   │   ├── redis-cache-adapter.ts # Cache storage adapter
│   │   ├── redis.ts              # Redis client (ioredis)
│   │   ├── service-health.ts     # gRPC health check probe
│   │   ├── shutdown.ts           # Graceful shutdown handlers
│   │   └── tracing.ts            # OpenTelemetry setup
│   ├── services/                 # Cache and lock services
│   ├── shared/                   # Generated code, proto definitions
│   │   ├── generated/prisma/     # Generated Prisma client
│   │   ├── grpc/                 # Chats service gRPC client
│   │   └── proto/                # Proto definitions
│   └── utils/                    # General utilities
│
├── components/                   # Shared UI components (Shadcn)
├── providers/                    # React context providers
├── prisma/                       # Database schema and migrations
├── schemas/                      # Re-exports of the domain schemas
├── types/                        # TypeScript type augmentations
├── infra/                        # Docker Compose files for this service
├── test/                         # Test utilities, mocks, MSW handlers, load rig
├── e2e/                          # Playwright E2E tests
├── proxy.ts                      # Route protection and request logging
├── instrumentation.ts            # Startup hook (config, tracing, shutdown)
├── docs/                         # This documentation
└── ...
```

## Key Design Patterns

### Feature Modules

Each feature module follows a consistent structure. The chat feature is the biggest one:

```
features/chat/
├── actions/              # Server actions (chat, file extraction)
├── components/           # React components
│   └── layout/           # Header, sidebar, user menu
├── constants.ts          # Feature-specific constants
├── hooks/                # React hooks
├── services/             # Backend service adapters
│   ├── chat-service.interface.ts  # Re-export of lib/domain/chat-service.ts
│   ├── grpc-chat-service.ts       # gRPC implementation
│   ├── inference-service.ts       # Inference client
│   ├── mock-chat-service.ts       # Test mock
│   ├── analysis-orchestrator.ts   # The live analysis flow
│   ├── file-extraction.service.ts # Document parser client
│   └── index.ts                   # Picks the mock or the real implementation
├── stores/               # Zustand state stores
├── types.ts              # Feature-specific types
├── utils/                # Utility functions
└── __tests__/            # Unit, integration and backend integration tests
```

**Why this structure?**
- Everything related to "chat" is in one place
- Easy to test (mock services live alongside real ones)
- Clear interface boundaries (`IChatService`)

**Tests are split into tiers**, and the folder names say which is which:

| Folder | What Runs It | Needs Docker |
|--------|---------------|--------------|
| `__tests__/unit/` | `pnpm test:run` | No |
| `__tests__/integration/` | `pnpm test:run` | No |
| `__tests__/integration-backend/` | `pnpm test:integration:backend` | No for a local run. One test in this tier starts a container, but only in CI or when `RUN_OTEL_TESTS` is set, and it skips itself when no container runtime is available |
| `lib/infrastructure/__tests__/ha/` | `pnpm test:integration:ha` | Yes |

### Domain Types

Domain types are defined in `lib/domain/` and represent the core business concepts:

```typescript
// lib/domain/chat.ts
interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  analysis?: AnalysisResult
  analysisStatus?: PersistedAnalysisStatus
  analysisLink?: AnalysisLink
  createdAt: Date
  isStreaming?: boolean
  streamingProgress?: StreamingAnalysisProgress
}

interface AnalysisResult {
  model: "spark" | "flare"
  label: "AI" | "Human"
  confidence: number
  scores: AnalysisScore
  highlights: AnalysisHighlightSpan[]
  raw: unknown
}

interface ChatSession {
  id: string
  title: string
  messages: Message[]
  updatedAt: Date
}
```

**Why separate domain types?**
- Frontend and backend share the same type definitions
- Clear contract between components
- Easy to validate data matches expected shapes

**The analysis lifecycle is part of the type.** A message carries not only its result but also the state of that result — `running`, `cancelled` or `failed` — which is what lets the UI show an analysis that is still in progress, or one that failed, without inventing a separate model.

### Configuration System

Configuration uses a three-mode system (`ENV_TYPE`):

```mermaid
graph LR
    ENV{ENV_TYPE}
    ENV -->|dev| Dev[.env + defaults]
    ENV -->|prod| Prod[AWS Secrets + SSM]
    ENV -->|preview| Preview[Mock values]

    Dev --> Zod[Zod Validation]
    Prod --> Zod
    Preview --> Zod

    Zod --> Strict{ENV_TYPE = prod?}
    Strict -->|Yes| ProdStrict[Prod Strict Checks]
    Strict -->|No| Ready[Config Ready]
    ProdStrict --> Ready
```

**Zod validation runs first, then the prod-only checks.** The strict checks read the values that Zod has already normalised, so they never run against a half-validated config.

See [Configuration](../getting-started/configuration.md) for details.

### Infrastructure Adapters

External systems are accessed through adapter modules in `lib/infrastructure/`:

| Adapter | Purpose | Library |
|---------|---------|---------|
| `prisma.ts` | PostgreSQL ORM | Prisma Client + `@prisma/adapter-pg` |
| `redis.ts` | Redis operations | ioredis |
| `redis-cache-adapter.ts` | Cache storage for `CacheService` | ioredis |
| `grpc-client.ts` | gRPC to the inference service | @grpc/grpc-js |
| `lib/shared/grpc/chat-client.ts` | gRPC to the chats service | @grpc/grpc-js |
| `grpc-loader.ts` | Proto file loading | @grpc/proto-loader |
| `analytics-publisher.ts` | RabbitMQ message publishing | amqplib |
| `logger.ts` | Structured logging | pino |
| `logging/sink.ts` | OTLP log sink | @opentelemetry/api-logs |
| `logging/pino-hook.ts` | Pino hook that feeds the sink | pino |
| `metrics.ts` | Prometheus metrics | prom-client |
| `tracing.ts` | Distributed tracing | OpenTelemetry |
| `service-health.ts` | gRPC health probes | @grpc/grpc-js |
| `shutdown.ts` | Graceful shutdown handlers | Node.js |

**Why adapters?**
- Easy to swap implementations (e.g., mock Redis in tests)
- Clear dependency boundaries
- Infrastructure concerns don't leak into business logic

## How the Service Starts

When the Next.js app starts, it:

1. **Loads configuration** — Resolves `ENV_TYPE` and validates all env vars
2. **Initializes tracing** — Sets up OpenTelemetry (if `OTEL_EXPORTER_OTLP_ENDPOINT` is set and the app is not in preview mode)
3. **Registers shutdown handlers** — Graceful cleanup for SIGTERM/SIGINT
4. **Starts the Next.js server** — Serves UI and API routes

```mermaid
graph TB
    Start[App Starts] --> Config[Load Configuration]
    Config --> Tracing[Initialize OTEL Tracing]
    Tracing --> Shutdown[Register Shutdown Handlers]
    Shutdown --> Server[Start Next.js Server]
    Server --> Ready[Ready to Serve Requests]
```

This all happens in `instrumentation.ts`, which Next.js runs before the app serves its first request.

## How Requests Are Protected

The `proxy.ts` file at the root of the app is Next.js 16's replacement for the older `middleware.ts`. It runs before every request that is not on the exempt list, and it does two things:

1. **Redirects** — sends a signed-in user away from `/login` and `/signup`, and a signed-out user away from `/chat` and `/profile`
2. **Logs** — records the method, path, status and duration of every request that passes through

See [Authentication](../components/auth.md) for the exact rules.

## Why This Design?

| Benefit | Explanation |
|---------|-------------|
| **Single deployment** | One app serves UI and API, simplifying ops |
| **Feature isolation** | Each feature is self-contained with its own components, hooks, and services |
| **Type safety** | Shared domain types ensure consistency across frontend and backend |
| **Testability** | Mock services live alongside real ones; tests run in isolation |
| **Flexibility** | Can swap backend services without changing UI code |
| **Observability** | Built-in metrics, logging, and tracing from the start |

## Next Steps

- [Request Flows](request-flows.md) - See how requests are processed
- [Configuration](../getting-started/configuration.md) - Learn about settings
- [Backend Services](../components/services.md) - How the service connects to backends
