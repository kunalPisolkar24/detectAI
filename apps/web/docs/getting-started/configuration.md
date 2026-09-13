# Configuration

This document explains how to configure the Web service for `ENV_TYPE=dev` (local), `ENV_TYPE=prod` (AWS), and `ENV_TYPE=preview` (mock UI development).

## Env Type

| Var | Default | Required | Notes |
|---|---|---|---|
| `ENV_TYPE` | `dev` | no | Canonical switch. `dev` = local with `.env` defaults; `prod` = AWS Secrets Manager + SSM; `preview` = mock values for UI-only development. `development` → `dev`, `production` → `prod` aliases accepted. |

## How Configuration Works

```mermaid
graph TB
    Start[App Starts] --> Resolve{ENV_TYPE?}
    Resolve -->|dev| Dev[Load .env + dev defaults]
    Resolve -->|prod| Prod[Load AWS Secrets + SSM]
    Resolve -->|preview| Preview[Apply mock defaults]
    Dev --> Validate[Validate with Zod]
    Prod --> Strict[Strict prod validation]
    Preview --> Validate
    Strict --> Validate
    Validate --> Ready[Config ready]
```

* **`ENV_TYPE=dev`** — Loads `.env` in `apps/web/` if present, applies dev defaults for missing values, validates with Zod schema.
* **`ENV_TYPE=prod`** — Loads secrets from AWS Secrets Manager (`detectai/pg/urls`, `detectai/redis/users/urls`, `detectai/mq/urls`, `detectai/web/secrets`), loads non-secret overrides from env or SSM (`/detectai/web/`), then validates with strict prod checks.
* **`ENV_TYPE=preview`** — Applies mock values for all services. No real databases or APIs needed. Any email/password works for login.

## Required Configuration

```bash
ENV_TYPE=dev                              # or 'prod' or 'preview'
DATABASE_URL=postgresql://user:pass@host:5432/detect_ai
REDIS_URL=redis://:password@host:6379
NEXTAUTH_SECRET=your-random-32-char-string
```

| Setting | What It Does | Example |
|---------|--------------|---------|
| `ENV_TYPE` | Controls config source | `dev`, `prod`, or `preview` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/detect_ai` |
| `REDIS_URL` | Redis connection (`redis://` or `rediss://` for TLS) | `redis://:password@localhost:6379` |
| `NEXTAUTH_SECRET` | Secret for JWT signing (min 16 chars) | Random 32-char string |

## Optional Configuration

### Authentication

```bash
NEXTAUTH_URL=http://localhost:3000          # Base URL for NextAuth callbacks
GOOGLE_ID=your-google-client-id            # Google OAuth client ID
GOOGLE_SECRET=your-google-client-secret    # Google OAuth client secret
GITHUB_ID=your-github-client-id            # GitHub OAuth client ID
GITHUB_SECRET=your-github-client-secret    # GitHub OAuth client secret
TURNSTILE_SECRET_KEY=your-turnstile-key    # Cloudflare Turnstile secret
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-site-key  # Turnstile public key
```

### Backend Services

```bash
AI_SERVICE_URL=localhost:50051              # Inference service gRPC endpoint
AI_SERVICE_API_KEY=your-api-key            # API key for inference service
CHAT_SERVICE_URL=localhost:50051            # Chats service gRPC endpoint
FILE_EXTRACTOR_API_URL=http://localhost:8000  # Document parser HTTP endpoint
PAYMENT_GATEWAY_URL=http://localhost:8080   # Payment gateway HTTP endpoint
INTERNAL_API_KEY=your-internal-key          # Internal API key for load tests
```

### Database Pool

```bash
DB_POOL_MAX=5                              # Max PostgreSQL connections (1-50)
DATABASE_URL_REPLICA=                      # Read replica URL (optional)
```

### Messaging

```bash
RABBITMQ_URL=amqp://guest:guest@localhost:5672/  # RabbitMQ for analytics events
```

### Observability

```bash
LOG_LEVEL=info                             # debug, info, warn, error
OTEL_EXPORTER_OTLP_ENDPOINT=               # http(s):// — empty disables tracing
OTEL_SERVICE_NAME=web                      # OpenTelemetry service name
PROMETHEUS_WEB_SCRAPE_TOKEN=               # Token for /metrics endpoint auth
```

### Client-Side

```bash
NEXT_PUBLIC_ENV_TYPE=dev                   # Exposed to browser
NEXT_PUBLIC_PREVIEW_MODE=false             # Preview mode flag
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=           # Paddle.js client token
```

### AWS (prod only)

```bash
AWS_REGION=ap-south-1                      # AWS region for Secrets Manager/SSM
```

## Environment Examples

### Local Development (ENV_TYPE=dev)

```bash
ENV_TYPE=dev
DATABASE_URL=postgresql://user:password@localhost:5432/detect_ai
REDIS_URL=redis://:user_cache_password@localhost:6379
NEXTAUTH_SECRET=change-me-to-a-random-32-char-string
NEXTAUTH_URL=http://localhost:3000
LOG_LEVEL=debug
```

With `.env` file, `ENV_TYPE=dev` auto-loads it. Missing values fall back to dev defaults (e.g., `AI_SERVICE_URL` defaults to `ai-service:50051`).

### Production (AWS)

```bash
ENV_TYPE=prod
AWS_REGION=ap-south-1
# No DATABASE_URL / REDIS_URL in env — pulled from Secrets Manager:
#   detectai/pg/urls, detectai/redis/users/urls, detectai/mq/urls, detectai/web/secrets
# Optional non-secret overrides from env or SSM /detectai/web/:
LOG_LEVEL=info
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector:4318
```

### Preview Mode (UI Development)

```bash
ENV_TYPE=preview
# No other variables needed — all mock values are applied automatically
```

## Configuration Validation

The service validates all environment variables at startup using Zod schemas.

| Error | Cause | Fix |
|-------|-------|-----|
| `ENV_TYPE must be dev, prod or preview` | Invalid env type | Set to `dev`, `prod`, or `preview` |
| `Invalid environment variables` | Missing or malformed vars | Check the error message for which vars failed |
| `ENV_TYPE=prod requires AWS_REGION` | Missing region in prod | Set `AWS_REGION` |
| `ENV_TYPE=prod missing required keys` | Secrets not loaded from AWS | Ensure secrets exist in Secrets Manager |
| `ENV_TYPE=prod must not use default dev/preview DATABASE_URL` | Dev URL leaked to prod | Point at real PostgreSQL |
| `ENV_TYPE=prod must not use default dev/preview REDIS_URL` | Dev Redis leaked to prod | Point at real Redis |
| `ENV_TYPE=prod requires a real NEXTAUTH_SECRET` | Mock or short secret | Use a real 16+ char secret |
| `ENV_TYPE=prod must not use mock OAuth credentials` | Mock Google/GitHub IDs | Use real OAuth credentials |

## Prod Strict Validation

In `ENV_TYPE=prod`, additional checks ensure no dev/mock values leak:

- `DATABASE_URL` must not contain `postgres-users:5432` or `preview:preview`
- `REDIS_URL` must not contain `user_cache_password@redis-users`
- `RABBITMQ_URL` must not contain `guest:guest`
- `NEXTAUTH_SECRET` must be >= 16 characters and not a mock value
- `GOOGLE_ID/SECRET` and `GITHUB_ID/SECRET` must not be mock values
- `AI_SERVICE_API_KEY` must not be a mock value
- `INTERNAL_API_KEY` must be >= 16 characters if set

Failed validation crashes the app at startup.

## Developer Workflow

| Command | What It Does |
|---------|--------------|
| `npm run dev` | Start Next.js dev server with hot reload |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run preview:build` | Build in preview mode (mock services) |
| `npm run preview:start` | Start in preview mode |
| `npm run lint` | Run ESLint |
| `npm run test:run` | Run unit tests |
| `npm run test:integration:backend` | Run backend integration tests |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run Prisma migrations (dev) |
| `npm run db:migrate:deploy` | Run Prisma migrations (prod) |

## Troubleshooting

**Service won't start?**
- Check `ENV_TYPE` is set correctly.
- Verify `DATABASE_URL` and `REDIS_URL` are reachable.
- Look for validation errors in the error message.

**Connection refused?**
- Ensure PostgreSQL and Redis are running (`docker compose -f infra/docker/data/compose.yml ps`).
- Check ports match your `DATABASE_URL` and `REDIS_URL`.

**Auth not working?**
- Verify `NEXTAUTH_SECRET` is set and >= 16 characters.
- Check `NEXTAUTH_URL` matches your dev server URL.
- Ensure `GOOGLE_ID/SECRET` and `GITHUB_ID/SECRET` are set (or use credentials provider).

**Prod strict failure?**
- `must not use default dev/preview DATABASE_URL` → Remove dev database URL from env.
- `missing required keys` → Ensure secrets exist in AWS Secrets Manager.

## Related Documentation

- [Architecture](../concepts/architecture.md) — How components connect
- [Health Checks](../operations/health.md) — How to verify configuration is working
- [Authentication](../components/auth.md) — Auth provider configuration
