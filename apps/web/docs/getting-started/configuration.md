# Configuration

This document explains how to configure the Web service for `ENV_TYPE=dev` (local), `ENV_TYPE=prod` (AWS), and `ENV_TYPE=preview` (mock UI development).

## Env Type

| Var | Default | Required | Notes |
|---|---|---|---|
| `ENV_TYPE` | `dev` | no | Canonical switch. `dev` = local with `.env` defaults; `prod` = AWS Secrets Manager + SSM; `preview` = mock values for UI-only development. `development` → `dev`, `production` → `prod`, `test` → `dev` aliases accepted. |

**How the mode is resolved:**

1. `ENV_TYPE` if it is `dev`, `prod` or `preview`
2. `ENV_TYPE=production` → `prod`, `ENV_TYPE=development` → `dev`, `ENV_TYPE=test` → `dev`
3. `PREVIEW=true`, `PREVIEW_MODE=true` or `NEXT_PUBLIC_PREVIEW_MODE=true` → `preview` (deprecated — use `ENV_TYPE=preview`)
4. `CONFIG_SOURCE=aws` or `prod` → `prod`, `CONFIG_SOURCE=env` or `dev` → `dev` (deprecated)
5. `NODE_ENV=production` → `prod`, otherwise `dev`

The deprecated forms print a warning but still work.

## How Configuration Works

```mermaid
graph TB
    Start[App Starts] --> Resolve{ENV_TYPE?}
    Resolve -->|dev| Dev[Load .env + dev defaults]
    Resolve -->|prod| Prod[Load AWS Secrets + SSM]
    Resolve -->|preview| Preview[Apply mock defaults]
    Dev --> Validate[Validate with Zod]
    Prod --> Validate
    Preview --> Validate
    Validate --> Strict{ENV_TYPE = prod?}
    Strict -->|Yes| ProdStrict[Prod strict checks]
    Strict -->|No| Ready[Config ready]
    ProdStrict --> Ready
```

* **`ENV_TYPE=dev`** — Loads `.env` in `apps/web/` if present, applies dev defaults for missing values, validates with Zod schema.
* **`ENV_TYPE=prod`** — Loads secrets from AWS Secrets Manager (`detectai/pg/urls`, `detectai/redis/users/urls`, `detectai/mq/urls`, `detectai/web/secrets`), loads non-secret overrides from env or SSM (`/detectai/web/`), then validates with Zod and the strict prod checks.
* **`ENV_TYPE=preview`** — Applies mock values for all services. No real databases or APIs needed. Any email/password works for login.

**Zod validation runs before the strict prod checks.** The strict checks read the values Zod has already normalised, so they never run against a half-validated config. A failed validation crashes the app at startup.

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
| `NEXTAUTH_SECRET` | Secret for JWT signing | Random 32-char string |

**Three more are required in production:** `RABBITMQ_URL`, `TURNSTILE_SECRET_KEY` and `AI_SERVICE_API_KEY` must also be set, alongside the four above — six required keys in total. The strict prod checks fail if any of them is missing.

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
AI_SERVICE_URL=ai-service:50051              # Inference service gRPC endpoint
AI_SERVICE_API_KEY=your-api-key             # API key for inference service
CHAT_SERVICE_URL=chat-service:50051         # Chats service gRPC endpoint
FILE_EXTRACTOR_API_URL=http://document-parser:8000  # Document parser HTTP endpoint
PAYMENT_GATEWAY_URL=http://payment-gateway:8080   # Payment gateway HTTP endpoint
INTERNAL_API_KEY=your-internal-key          # Internal API key for load tests
```

### Database Pool

```bash
DB_POOL_MAX=5                              # Max PostgreSQL connections (1-50)
DATABASE_URL_REPLICA=                      # Read replica URL (optional)
```

`POOL_MAX` is accepted as an alias for `DB_POOL_MAX`.

### Messaging

```bash
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672/  # RabbitMQ for analytics events
```

### Rate Limiting

```bash
ABUSE_RATE_LIMIT_ANALYZE_MAX=20            # Requests per window on the analyze endpoint
ABUSE_RATE_LIMIT_ANALYZE_WINDOW_MS=60000   # Window length in milliseconds
ABUSE_RATE_LIMIT_AUTH_MAX=30               # Reserved for the auth scope
ABUSE_RATE_LIMIT_AUTH_WINDOW_MS=60000      # Reserved for the auth scope
ABUSE_RATE_LIMIT_DEFAULT_MAX=120           # Reserved for the default scope
ABUSE_RATE_LIMIT_DEFAULT_WINDOW_MS=60000   # Reserved for the default scope
```

See [Rate Limiting](../components/rate-limiting.md) for what these do.

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
AWS_ENDPOINT_URL=http://host.docker.internal:4566  # LocalStack or Floci
SSM_PREFIX=/detectai/web/                  # SSM parameter prefix
```

The secret names can be overridden individually:

```bash
PG_URLS_SECRET_NAME=detectai/pg/urls
REDIS_URLS_SECRET_NAME=detectai/redis/users/urls
MQ_URLS_SECRET_NAME=detectai/mq/urls
WEB_SECRETS_NAME=detectai/web/secrets
```

Set `SSM_ENABLED=0` to skip the SSM lookup entirely. It only takes effect when no `SSM_PREFIX` is configured — with a prefix set, the lookup runs regardless.

### Other

```bash
NODE_ENV=development                       # development, test or production
REDIS_PASSWORD=                            # Redis password, if not in the URL
SKIP_ENV_VALIDATION=true                   # Skip the t3-env validation layer
ENV_FILE=/path/to/file                     # Load a specific env file instead of .env
```

## Environment Examples

### Local Development (ENV_TYPE=dev)

```bash
ENV_TYPE=dev
DATABASE_URL=postgresql://user:password@postgres-users:5432/detect_ai
REDIS_URL=redis://:user_cache_password@redis-users:6379
NEXTAUTH_SECRET=change-me-to-a-random-32-char-string
NEXTAUTH_URL=http://localhost:3000
LOG_LEVEL=debug
```

With a `.env` file, `ENV_TYPE=dev` auto-loads it. Missing values fall back to dev defaults.

**The dev defaults point at the Docker Compose service names**, not at `localhost`:

| Variable | Dev default |
|----------|-------------|
| `DATABASE_URL` | `postgresql://user:password@postgres-users:5432/detect_ai` |
| `REDIS_URL` | `redis://:user_cache_password@redis-users:6379` |
| `AI_SERVICE_URL` | `ai-service:50051` |
| `CHAT_SERVICE_URL` | `chat-service:50051` |
| `FILE_EXTRACTOR_API_URL` | `http://document-parser:8000` |
| `PAYMENT_GATEWAY_URL` | `http://payment-gateway:8080` |
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` |

That works when the app runs inside the Compose network. If you run `next dev` directly on your machine, replace the hostnames with `localhost` and set the ports the services actually listen on.

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

**The secrets are read from four places:**

| Secret | Keys it provides |
|--------|------------------|
| `detectai/pg/urls` | `DATABASE_URL`, `DATABASE_URL_REPLICA` |
| `detectai/redis/users/urls` | `REDIS_URL`, `REDIS_PASSWORD` |
| `detectai/mq/urls` | `RABBITMQ_URL` |
| `detectai/web/secrets` | `NEXTAUTH_SECRET`, the OAuth credentials, `TURNSTILE_SECRET_KEY`, `AI_SERVICE_API_KEY`, `INTERNAL_API_KEY`, `PROMETHEUS_WEB_SCRAPE_TOKEN`, and the two `NEXT_PUBLIC_*` values |

Non-secret settings can be overridden from the environment or from SSM under `/detectai/web/`.

### Preview Mode (UI Development)

```bash
ENV_TYPE=preview
# No other variables needed — all mock values are applied automatically
```

## Configuration Validation

The service validates all environment variables at startup using Zod schemas.

| Error | Cause | Fix |
|-------|-------|-----|
| `ENV_TYPE must be dev, prod or preview, got "<value>"` | Invalid env type | Set to `dev`, `prod`, or `preview` |
| `Invalid environment variables for [web]: <details>` | Missing or malformed vars | Check the error message for which vars failed |
| `ENV_TYPE=prod requires AWS_REGION` | Missing region in prod | Set `AWS_REGION` |
| `ENV_TYPE=prod missing required keys: <list>` | Secrets not loaded from AWS | Ensure the secrets exist in Secrets Manager |
| `ENV_TYPE=prod must not use default dev/preview DATABASE_URL` | Dev URL leaked to prod | Point at real PostgreSQL |
| `ENV_TYPE=prod must not use default dev/preview REDIS_URL` | Dev Redis leaked to prod | Point at real Redis |
| `ENV_TYPE=prod must not use default dev RabbitMQ URL (guest:guest)` | Dev broker leaked to prod | Point at real RabbitMQ |
| `ENV_TYPE=prod requires a real NEXTAUTH_SECRET ( >=16 chars, not mock)` | Mock or short secret | Use a real 16+ char secret |
| `ENV_TYPE=prod must not use mock OAuth credentials (GOOGLE_ID/SECRET, GITHUB_ID/SECRET)` | Mock Google/GitHub IDs | Use real OAuth credentials |
| `ENV_TYPE=prod must not use test Turnstile secret key` | Cloudflare's always-pass test key | Use a real Turnstile secret |
| `INTERNAL_API_KEY must be at least 16 characters in prod` | Short internal key | Use a 16+ char key |
| `PROMETHEUS_WEB_SCRAPE_TOKEN must be at least 16 characters if set` | Short scrape token | Use a 16+ char token |
| `ENV_TYPE=prod must not use mock AI_SERVICE_API_KEY` | Mock inference key | Use the real key |

## Prod Strict Validation

In `ENV_TYPE=prod`, additional checks ensure no dev/mock values leak:

- `DATABASE_URL` must not contain `postgres-users:5432`, `localhost:5432/preview` or `preview:preview@`
- `REDIS_URL` must not contain `user_cache_password@redis-users` or be the preview URL
- `RABBITMQ_URL` must not contain `guest:guest`
- `NEXTAUTH_SECRET` must be at least 16 characters and not a mock value
- `GOOGLE_ID/SECRET` and `GITHUB_ID/SECRET` must not be mock values
- `TURNSTILE_SECRET_KEY` must not be the Cloudflare test key
- `AI_SERVICE_API_KEY` must not be a mock value
- `INTERNAL_API_KEY` must be at least 16 characters if set
- `PROMETHEUS_WEB_SCRAPE_TOKEN` must be at least 16 characters if set

A value counts as "mock" only when it contains **both** `mock-` and `not-configured`. Failed validation crashes the app at startup.

## Developer Workflow

| Command | What It Does |
|---------|--------------|
| `pnpm dev` | Start Next.js dev server with hot reload |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm preview:build` | Build in preview mode (mock services) |
| `pnpm preview:start` | Start in preview mode |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run unit tests in watch mode |
| `pnpm test:run` | Run unit tests |
| `pnpm test:integration:backend` | Run backend integration tests |
| `pnpm test:integration:ha` | Run high-availability integration tests (needs Docker) |
| `pnpm test:e2e` | Run Playwright E2E tests |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Run Prisma migrations (dev) |
| `pnpm db:migrate:deploy` | Run Prisma migrations (prod) |

## Troubleshooting

**Service won't start?**
- Check `ENV_TYPE` is set correctly.
- Verify `DATABASE_URL` and `REDIS_URL` are reachable.
- Look for validation errors in the error message.

**Connection refused?**
- Ensure PostgreSQL and Redis are running (`docker compose -f infra/docker/data/compose.yml ps`).
- Check ports match your `DATABASE_URL` and `REDIS_URL`.
- If you are not running in Docker, check that your URLs use `localhost` rather than the Compose service names.

**Auth not working?**
- Verify `NEXTAUTH_SECRET` is set and at least 16 characters.
- Check `NEXTAUTH_URL` matches your dev server URL.
- Ensure `GOOGLE_ID/SECRET` and `GITHUB_ID/SECRET` are set (or use credentials provider).

**Prod strict failure?**
- `must not use default dev/preview DATABASE_URL` → Remove dev database URL from env.
- `missing required keys` → Ensure secrets exist in AWS Secrets Manager.

## Related Documentation

- [Architecture](../concepts/architecture.md) — How components connect
- [Health Checks](../operations/health.md) — How to verify configuration is working
- [Authentication](../components/auth.md) — Auth provider configuration
- [Rate Limiting](../components/rate-limiting.md) — Tuning the limiters
