# Quick Start

This guide will help you get the Web service running quickly.

## Prerequisites

- Node.js 20+ and pnpm
- Docker and Docker Compose
- Git

## Two Ways to Run It

| | Docker stack | Directly on your machine |
|---|---|---|
| Command | `make start` | `pnpm dev` |
| What you need | Docker only | PostgreSQL, Redis and RabbitMQ running on `localhost` |
| Service URLs | The Compose service names | `localhost` |
| Best for | Working on the whole system | Fast frontend iteration |

Both paths use the same `.env` file. The only difference is which hostnames it points at.

## Running Locally

### Step 1: Install Dependencies

```bash
cd apps/web
pnpm install
```

The repository uses **pnpm**, and `pnpm-lock.yaml` is the source of truth. Using `npm install` would resolve a fresh, unpinned tree that does not match the lockfile.

### Step 2: Set Up Environment Variables

Create a `.env` file in the `apps/web` directory. The quickest way is to copy the example:

```bash
cd apps/web
cp .env.example .env
```

That gives you a working configuration for the Docker stack. If you want to run `pnpm dev` on your own machine instead, change the service URLs to point at `localhost`:

```bash
# Minimal .env for running the app directly on your machine
ENV_TYPE=dev
DATABASE_URL=postgresql://user:password@localhost:5432/detect_ai
REDIS_URL=redis://:user_cache_password@localhost:6379
NEXTAUTH_SECRET=change-me-to-a-random-32-char-string
NEXTAUTH_URL=http://localhost:3000
GOOGLE_ID=mock-google-client-id-not-configured
GOOGLE_SECRET=mock-google-client-secret-not-configured
GITHUB_ID=mock-github-client-id-not-configured
GITHUB_SECRET=mock-github-client-secret-not-configured
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
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

### Step 3: Start the Datastores

If you are running the app on your own machine, it still needs a database, a cache and a queue:

```bash
# From the project root
docker compose -f infra/docker/data/compose.yml up -d
```

This starts:
- **postgres-users** — PostgreSQL database on port 5432
- **redis-users** — Redis cache on port 6379

The queue is part of the web Compose stack rather than this bundle. `make start` brings it up along with everything else.

> **Do not run this and `make start` at the same time.** They both bind port 5432 and 6379 on the host, and the second one to start will fail. Pick one path.

### Step 4: Start the App

**With Docker**, from `apps/web`:

```bash
make start
```

That builds the image and starts the web service along with PostgreSQL and Redis. Watch the logs with `make logs`.

**Without Docker**, from `apps/web`:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Step 5: Try It Out

1. **Sign up** with an email, a first name, a last name, and a password of at least 8 characters
2. **Navigate** to the chat page
3. **Enter text** in the analysis input
4. **Click Analyze** to see AI detection results

The analysis needs the inference service to be running. Without it the request fails with `AI Analysis Service Unavailable` — the rest of the app still works.

## What Just Happened?

1. **The proxy** checked your session and let the request through (`proxy.ts`)
2. **Authentication** created a session via NextAuth (JWT strategy)
3. **API Route** (`/api/chat/analyze/stream`) received the analysis request
4. **The abuse limiter** checked how fast you were calling the endpoint
5. **Rate Limiting** checked your daily usage against Redis
6. **The Chats service** stored your message and the analysis shell
7. **The Inference service** analyzed the text
8. **Streaming** sent results back as NDJSON chunks

## Preview Mode

For running the app without any backend services (great for UI development):

```bash
pnpm preview:build
pnpm preview:start
```

Or, with Docker:

```bash
make preview
```

Preview mode uses mock values for all services and accepts any credentials. It needs no `.env` file, no database, and no queue. See [Configuration](configuration.md) for details.

## Running the Whole Stack

To run the web service together with the backend services:

```bash
# From the project root
make local-up
```

This starts the web service along with PostgreSQL, Redis, the chats service, the inference service, the document parser, the payment gateway and the background workers.

## Running Tests

```bash
# Unit and integration tests
pnpm test:run

# Backend integration tests
pnpm test:integration:backend

# High-availability tests (needs Docker containers)
pnpm test:integration:ha

# E2E tests (needs a preview build running)
pnpm test:e2e
```

## Next Steps

- [Configuration](configuration.md) - Customize settings for your environment
- [Architecture](../concepts/architecture.md) - Understand how the service is built
- [Authentication](../components/auth.md) - Learn about the auth system

## Troubleshooting

### "Module not found" errors

Make sure you've installed dependencies:
```bash
pnpm install
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
PORT=3001 pnpm dev
```

### "NEXTAUTH_SECRET is missing"

Add `NEXTAUTH_SECRET` to your `.env` file. Generate one with:
```bash
openssl rand -base64 32
```

### Prisma client not generated

Run the Prisma generate command:
```bash
pnpm db:generate
```

### The app starts but the analysis always fails

The inference service is not running. Start the whole stack with `make local-up` from the project root, or point `AI_SERVICE_URL` at a running instance.

### The OAuth buttons do nothing

The mock OAuth credentials in `.env.example` are not valid client credentials.
The buttons still work — they start a real OAuth round trip — but the provider
rejects them. Add real client IDs and secrets to use Google or GitHub sign-in.

In preview mode the buttons are disabled outright.

## Stopping Services

```bash
# Stop the web stack
cd apps/web && make down

# Stop infrastructure only
docker compose -f infra/docker/data/compose.yml down

# Stop and remove volumes (fresh start)
docker compose -f infra/docker/data/compose.yml down -v
```
