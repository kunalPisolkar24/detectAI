# Quick Start

This guide will help you get the Web service running quickly.

## Prerequisites

- Node.js 20+ and npm/pnpm
- Docker and Docker Compose
- Git

## Running Locally

### Step 1: Start Infrastructure Services

First, start the database and cache services that the web app depends on:

```bash
# From the project root
docker compose -f infra/docker/data/compose.yml up -d
```

This starts:
- **postgres-users** - PostgreSQL database on port 5432
- **redis-users** - Redis cache on port 6379

### Step 2: Install Dependencies

```bash
cd apps/web
npm install
```

### Step 3: Set Up Environment Variables

Create a `.env` file in the `apps/web` directory:

```bash
# Minimal .env for local development
ENV_TYPE=dev
DATABASE_URL=postgresql://user:password@localhost:5432/detect_ai
REDIS_URL=redis://:user_cache_password@localhost:6379
NEXTAUTH_SECRET=change-me-to-a-random-32-char-string
NEXTAUTH_URL=http://localhost:3000
GOOGLE_ID=mock-google-client-id-not-configured
GOOGLE_SECRET=mock-google-client-secret-not-configured
GITHUB_ID=mock-github-client-id-not-configured
GITHUB_SECRET=mock-github-client-secret-not-configured
TURNSTILE_SECRET_KEY=1x00000000000000000000AA
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=mock-paddle-client-token-not-configured
FILE_EXTRACTOR_API_URL=http://localhost:8000
AI_SERVICE_URL=localhost:50051
AI_SERVICE_API_KEY=dev-secret-key
CHAT_SERVICE_URL=localhost:50051
PAYMENT_GATEWAY_URL=http://localhost:8080
RABBITMQ_URL=amqp://guest:guest@localhost:5672/
```

> **Tip:** Many of these have sensible dev defaults. See [Configuration](configuration.md) for the full list.

### Step 4: Start the Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Step 5: Try It Out

1. **Sign up** with any email/password (credentials provider in dev mode)
2. **Navigate** to the chat page
3. **Enter text** in the analysis input
4. **Click Analyze** to see AI detection results

## What Just Happened?

1. **Frontend** rendered the React components with Next.js App Router
2. **Authentication** created a session via NextAuth (JWT strategy)
3. **API Route** (`/api/chat/analyze/stream`) received the analysis request
4. **Rate Limiting** checked your daily usage against Redis
5. **Inference Service** analyzed the text (if running) or returned mock data
6. **Streaming** sent results back as NDJSON chunks

## Preview Mode

For running the app without any backend services (great for UI development):

```bash
npm run preview:build
npm run preview:start
```

Preview mode uses mock values for all services and accepts any credentials. See [Configuration](configuration.md) for details.

## Docker Compose (Full Stack)

To run the web service with its infrastructure:

```bash
# From the project root
make local-up
```

This starts the web service along with PostgreSQL, Redis, and other services.

## Running Tests

```bash
# Unit tests
npm run test:run

# Integration tests (requires Docker containers)
npm run test:integration:backend

# E2E tests (requires preview build running)
npm run test:e2e
```

## Next Steps

- [Configuration](configuration.md) - Customize settings for your environment
- [Architecture](../concepts/architecture.md) - Understand how the service is built
- [Authentication](../components/auth.md) - Learn about the auth system

## Troubleshooting

### "Module not found" errors

Make sure you've installed dependencies:
```bash
npm install
```

### "Database connection refused"

Ensure PostgreSQL is running:
```bash
docker compose -f infra/docker/data/compose.yml ps
```

### "Port already in use"

Another process is using port 3000. Either stop it or change the port:
```bash
# Find what's using the port
lsof -i :3000

# Or use a different port
PORT=3001 npm run dev
```

### "NEXTAUTH_SECRET is missing"

Add `NEXTAUTH_SECRET` to your `.env` file. Generate one with:
```bash
openssl rand -base64 32
```

### Prisma client not generated

Run the Prisma generate command:
```bash
npx prisma generate
```

## Stopping Services

```bash
# Stop infrastructure
docker compose -f infra/docker/data/compose.yml down

# Stop and remove volumes (fresh start)
docker compose -f infra/docker/data/compose.yml down -v
```
