# Testing

This document explains how to test the Web service. Testing ensures the service works correctly and catches bugs before they reach users.

## Why Test?

Testing helps you to:
- **Catch bugs early** — Find problems before users do
- **Ensure quality** — Verify features work as expected
- **Enable changes** — Safely modify code knowing tests will catch mistakes
- **Document behavior** — Tests show how the service should work

## Testing Levels

The Web service has three levels of testing, each with different tradeoffs:

### Unit Tests

**What they are:** Tests that check individual parts of the code in isolation.

**When to use:** Every time you change code.

**Speed:** Fast (seconds).

**Dependencies:** None (uses mocks and fakes).

```bash
# Run unit tests
pnpm test:run

# Run in watch mode (re-runs on file changes)
pnpm test
```

**Example:** Testing that a rate limiter correctly checks usage limits.

```typescript
describe("Rate Limiter", () => {
  it("should allow requests under the limit", async () => {
    const service = new RedisRateLimitService(mockRedis)
    const result = await service.checkLimit("user123", false)
    expect(result.allowed).toBe(true)
  })
})
```

### Integration Tests

**What they are:** Tests that check several parts working together, with the boundaries between them mocked.

**When to use:** Before committing code.

**Speed:** Medium (minutes).

**Dependencies:** None. The backend integration suite mocks Redis, the analytics publisher and Prisma, so it runs without Docker. One test in this tier starts a container to stand up a stub OTLP collector, but it only runs in CI or when `RUN_OTEL_TESTS` is set, and it skips itself when no container runtime is available.

```bash
# Run backend integration tests
pnpm test:integration:backend
```

**Example:** Testing that the analysis route rejects a malformed body before it reaches the inference service.

### High-Availability Tests

**What they are:** Tests that run against a real three-node RabbitMQ cluster, to check that the analytics publisher behaves correctly when the broker is genuinely unreliable.

**When to use:** Before changing the analytics publisher or the queue topology.

**Speed:** Slow (minutes).

**Dependencies:** Docker. The cluster is started with testcontainers, not Compose.

```bash
# Run HA integration tests
pnpm test:integration:ha
```

### E2E Tests

**What they are:** Tests that check the full user flow in a real browser.

**When to use:** Before deploying to production.

**Speed:** Slower (minutes).

**Dependencies:** Playwright browser binaries.

```bash
# Run E2E tests (requires a preview build running)
pnpm test:e2e
```

**Example:** Testing that a user can sign in and see the chat interface.

## Choosing Which Tests to Run

| Change Type | Run These Tests |
|-------------|-----------------|
| Small bug fix | Unit tests |
| New feature | Unit + Integration |
| Configuration change | Unit + Integration |
| UI component change | Unit + E2E |
| API route change | Unit + Integration |
| Analytics publisher or queue change | Unit + Integration + HA |
| Quick check | Unit tests |
| Before deployment | All tests |

## Test Structure

```
apps/web/
├── features/
│   └── chat/
│       └── __tests__/           # Feature-specific tests, split by tier
│           ├── unit/            # Pure unit tests
│           │   ├── components/
│           │   ├── hooks/
│           │   ├── services/
│           │   └── utils/
│           ├── integration/     # Tests across the feature boundary
│           └── integration-backend/  # Tests against the API routes
├── lib/
│   └── infrastructure/
│       └── __tests__/
│           └── ha/              # High-availability tests (*.ha.test.ts)
├── test/
│   ├── custom-renderer.tsx      # Custom test renderer
│   ├── example.test.ts          # Example test
│   ├── handlers/
│   │   ├── auth-handlers.ts     # MSW handlers for the auth routes
│   │   └── chat-handlers.ts     # MSW handlers for the chat routes
│   ├── ha/
│   │   └── rabbitmq-cluster.ts  # Three-node RabbitMQ testcontainer
│   ├── infrastructure/
│   │   ├── common.ts            # Shared test helpers
│   │   ├── env.ts               # Environment mocking
│   │   ├── metrics.ts           # Metrics mocking
│   │   ├── prisma.ts            # Prisma mocking
│   │   ├── redis.ts             # Redis mocking
│   │   └── ui.ts                # UI test helpers
│   ├── load/
│   │   ├── scripts/                # k6 load test scripts
│   │   │   ├── lib/                # Shared config, payloads, checks
│   │   │   └── *.k6.js             # One script per scenario
│   │   ├── mock-server/            # gRPC and HTTP doubles
│   │   ├── seed/                   # Seeds the accounts the scripts sign in with
│   │   └── results/                # Run summaries (gitignored)
│   ├── mocks/
│   │   └── empty.ts             # Empty module, aliased in place of server-only
│   ├── msw-server.ts            # MSW server setup
│   ├── prisma-mock.ts           # Re-export of the Prisma mock
│   ├── setup-node.ts            # Node test setup
│   ├── setup.ts                 # General test setup
│   └── test-utils.tsx           # Test utilities
└── e2e/
    ├── auth.spec.ts             # Authentication E2E tests
    ├── chat.spec.ts             # Chat E2E tests
    └── upgrade.spec.ts          # Upgrade E2E tests
```

**Every feature uses the same three-tier layout**, so a test's location tells you what it needs. A test in `__tests__/integration-backend/` is part of the backend integration suite; a test in `__tests__/unit/` runs in the default job.

## Writing Tests

### Unit Test Example

```typescript
import { describe, it, expect, vi } from "vitest"
import { mapGrpcMessageToDomain } from "../../../utils/mappers"

describe("mapGrpcMessageToDomain", () => {
  it("should map gRPC message to domain message", () => {
    const grpcMsg = {
      id: "msg-123",
      chat_id: "chat-456",
      user_id: "user-789",
      role: "user",
      content: "Hello, world!",
      created_at: "1725900000",
      metadata: {},
    }

    const result = mapGrpcMessageToDomain(grpcMsg)

    expect(result.id).toBe("msg-123")
    expect(result.role).toBe("user")
    expect(result.content).toBe("Hello, world!")
    expect(result.createdAt).toBeInstanceOf(Date)
  })
})
```

### Integration Test Example

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock, setupPrismaMocks } from "@/test/infrastructure/prisma"

setupPrismaMocks()

describe("Rate limit check", () => {
  beforeEach(() => {
    prismaMock.usage.findUnique.mockResolvedValue(null)
  })

  it("allows a user under the daily cap", async () => {
    const service = new RedisRateLimitService(mockRedis)
    const result = await service.checkLimit("user123", false)
    expect(result.allowed).toBe(true)
  })
})
```

### E2E Test Example

```typescript
import { test, expect } from "@playwright/test"

test.describe("Chat Interaction", () => {
  test.beforeEach(async ({ page }) => {
    // Sign in before each test
    const csrfToken = await page.request
      .get("/api/auth/csrf")
      .then((r) => r.json())
      .then((body) => body.csrfToken)

    await page.request.post("/api/auth/callback/credentials?callbackUrl=/chat", {
      form: {
        csrfToken,
        email: "e2e@example.com",
        password: "password1234",
      },
    })
  })

  test("should render chat input area", async ({ page }) => {
    await page.goto("/chat")
    await expect(page.getByLabel(/text to analyze/i)).toBeVisible()
    await expect(page.getByLabel(/analyze text/i)).toBeVisible()
  })
})
```

## Test Utilities

### Custom Renderer

`test/custom-renderer.tsx` provides a `render` function that wraps the component in the app's providers:

```typescript
import { render } from "@testing-library/react"
import { SessionProvider } from "next-auth/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const renderWithProviders = (
  ui: React.ReactElement,
  { session = null, ...options }: ExtendedRenderOptions = {}
) => {
  const queryClient = createTestQueryClient()

  const AllProviders = ({ children }: { children: React.ReactNode }) => (
    <SessionProvider session={session}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          <LazyMotionProvider>{children}</LazyMotionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SessionProvider>
  )

  return render(ui, { wrapper: AllProviders, ...options })
}

export * from '@testing-library/react'
export { renderWithProviders as render }
```

The query client has `retry: false` and `gcTime: 0`, so a test never waits for a retry or for a cache to expire.

### MSW (Mock Service Worker)

MSW intercepts network requests for testing. The handlers are grouped per area and composed in `test/msw-server.ts`:

```typescript
// test/handlers/chat-handlers.ts
export const chatHandlers = [
  http.post("/api/chat/analyze/stream", async () => {
    const events = [
      { type: "accepted", message: { id: "msg-assistant", role: "assistant", content: "", createdAt: new Date().toISOString() } },
      { type: "started", totalChars: 100, totalChunks: 2 },
      { type: "progress", processedChunks: 1, totalChunks: 2 },
      { type: "progress", processedChunks: 2, totalChunks: 2 },
      { type: "final", message: createFinalMessage() },
    ]

    const body = events.map(e => JSON.stringify(e)).join('\n') + '\n'

    return new HttpResponse(body, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
  }),
]
```

The analyze handler returns NDJSON, the same shape the real route returns — not a single JSON object.

### Prisma Mock

The Prisma mock lives in `test/infrastructure/prisma.ts`, and `test/prisma-mock.ts` re-exports it:

```typescript
// test/infrastructure/prisma.ts
import { PrismaClient } from '@/lib/shared/generated/prisma/client'
import { vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, DeepMockProxy } from 'vitest-mock-extended'

export const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>

export const setupPrismaMocks = () => {
  vi.mock('@/lib/infrastructure/prisma', () => ({
    prisma: prismaMock,
  }))

  beforeEach(() => {
    mockReset(prismaMock)
  })
}
```

Note the import path: the Prisma client is generated into `lib/shared/generated/prisma`, not taken from the `@prisma/client` package.

## Test Configuration

### Vitest

Three configs, one per suite:

| Config | Command | Environment | Includes |
|--------|---------|-------------|----------|
| `vitest.config.ts` | `pnpm test:run` | `jsdom` | Everything except the HA tests, `e2e/**` and `.next/**` |
| `vitest.node.config.ts` | `pnpm test:integration:backend` | `node` | `features/**/__tests__/integration-backend/**/*.test.ts` |
| `vitest.node.ha.config.ts` | `pnpm test:integration:ha` | `node` | `lib/infrastructure/__tests__/ha/**/*.ha.test.ts` |

The default config has coverage thresholds on the `features/` directory: 75% branches, 80% functions, 80% lines and 80% statements.

The backend integration config aliases `server-only` to an empty module, so a module that imports it can be loaded in a test.

The HA config deliberately does **not** load `test/setup-node.ts`. Those global mocks would stub out the very broker the HA tests are exercising. Its timeouts are generous — 180 s per test and 300 s per hook — because a three-node cluster takes a while to settle.

### Playwright

E2E tests use Playwright:

```bash
# Run all E2E tests
pnpm test:e2e

# Run specific test file
pnpm exec playwright test e2e/chat.spec.ts

# Run in headed mode (see browser)
pnpm exec playwright test --headed
```

The test directory is `e2e/`, the base URL is `http://localhost:3000`, and the three browser engines all run.

## Load Testing

Load tests use **k6** to check performance under heavy traffic, and to pin
down what the service does with the requests it does *not* accept.

### Running Load Tests

The `make load-test` target brings up a self-contained rig (throwaway Postgres
and Redis, a mock backend server, a seeder and k6) and runs one script
against it.

```bash
# From apps/web
make load-test VUS=10 DURATION=2m

# A different script
make load-test SCRIPT=chat-api.k6.js VUS=10 DURATION=2m

# The whole suite, one fresh rig per script
make load-suite
```

The rig starts a throwaway Postgres, Redis and RabbitMQ, applies the
migrations, seeds two accounts (one free, one premium) and starts the app
against it. Every run tears the rig down again, so the counters one script
drives never leak into the next.

### Running Load Tests Against an Existing Deployment

The rig above is self-contained. To measure a deployment that is already
running — a local stack, the Floci stack, prod — point the same scripts at it
instead. Nothing is provisioned: the k6 container runs with `--no-deps`, so
the frontend and its datastores are never started by the load run.

```bash
# The target file carries the endpoint and the credentials.
# See e2e/targets/.env.example for the template.
make load-test REMOTE=1 TARGET_ENV_FILE=../../e2e/targets/.env.prod SCRIPT=chat-api.k6.js
```

Observability is the target's business here: a deployed stack already exports
its own telemetry, so `WITH_OBSERVABILITY` is ignored in remote mode.

Two things differ from the rig, and both are the target's business:

- **The backend is real.** The rig answers from a mock server, so its latency
  budget is milliseconds. A real deployment waits on real inference and takes
  seconds, so `WEB_ANALYZE_P95_MS` and `WEB_ANALYZE_P99_MS` carry the budget
  the target is held to. The scripts that never reach a backend — landing, the
  auth surface, the rejection matrix — keep the same budget in both places.
- **The accounts exist already.** The rig seeds them; a deployed target needs
  them planted once — the free account with no subscription, the premium one
  with an ACTIVE one. The target file carries the credentials.

The analyze path needs one more thing the rig fakes: a **chat that exists**.
The rig's mock backend accepts any chat id, but a real chats service answers
`NOT_FOUND` for one that does not exist, and the analyze route turns that
into a 500. `WEB_CHAT_ID` points the requests at a chat that exists and
belongs to the user the request carries.

`chat-api-rate-limit.k6.js` is refused in remote mode: it needs the abuse
limiter's own setting on the frontend, which only the rig controls.

The cross-app harness in `e2e/` drives this and the other services together:

```bash
make -C e2e load TIER=preflight TARGET=prod   # is everything reachable
make -C e2e load TIER=smoke TARGET=prod        # is everything correct
make -C e2e load TIER=load TARGET=prod         # does everything hold
```

See [e2e/README.md](../../../../e2e/README.md) for the tiers and the target files.

### Load Test Scenarios

`SCENARIO` picks a traffic shape. `VUS` and `DURATION` override it, so a
one-off run does not need a change to a script.

| Scenario | Virtual Users | Duration | Purpose |
|----------|---------------|----------|---------|
| Smoke | 1 | 10 seconds | Quick sanity check |
| Load | 10 | 2 minutes | Realistic traffic (default) |
| Stress | 50 | 5 minutes, ramped | Find breaking point |

```bash
make load-test SCRIPT=chat-api.k6.js SCENARIO=stress
```

### The Scripts

| Script | What it covers |
|--------|----------------|
| `landing.k6.js` | The landing page: status, content type, latency |
| `chat-api.k6.js` | The analyze endpoint under load, on both models, with the full NDJSON stream checked |
| `chat-api-invalid.k6.js` | Every body the service has to reject, and the two it has to accept |
| `chat-api-session.k6.js` | The analyze endpoint as a signed-in premium user, on the session path |
| `auth.k6.js` | The NextAuth endpoints: providers, CSRF, the credentials callback, the session |
| `chat-api-rate-limit.k6.js` | The rejection contract of the abuse limiter and the daily cap |

### The Rate Limit Scenarios

Two limiters stand in front of the analyze endpoint, and they need
different settings to be the one that refuses. The scenario takes a case:

```bash
# The abuse limiter refuses, with Retry-After and the rate limit headers
make load-test SCRIPT=chat-api-rate-limit.k6.js RATE_LIMIT_CASE=abuse

# The daily cap refuses, with a plain body and no headers
make load-test SCRIPT=chat-api-rate-limit.k6.js RATE_LIMIT_CASE=daily
```

The rig is configured to match: the abuse case runs with the abuse limit
lowered so the limiter itself refuses, the daily case with it out of the way
so the daily cap is the only one standing. `make load-suite` runs both.

### What "Invalid" Means Here

k6 counts every status of 400 and above as a failed request. The scripts
that expect a rejection widen the accepted set with
`http.setResponseCallback`, so a refusal does not read as a failure while a
5xx still does.

`chat-api-invalid.k6.js` cycles through the whole matrix on every run:

| Case | Expected |
|------|----------|
| `chatId`, `content` or `model` missing or empty | 400 |
| `content`, `chatId` or `model` of the wrong type | 400 |
| `model` outside `spark` and `flare` | 400 |
| `assistantCreatedAt` or `userCreatedAt` that is not a timestamp | 400 |
| `sourceMessageId` without the assistant message it implies | 400 |
| Content past 50 000 characters | 400 |
| A body that is not JSON at all | 400 |
| A missing or wrong internal key | 401 |
| A method the route does not implement | 405 |
| Content of exactly 50 000 characters | 200 |
| An unknown field alongside the valid ones | 200 |

The rejections have to be cheap. A refused request should be faster than one
that runs the analysis, and the thresholds say so.

### Thresholds

Every script fails the run when a threshold is crossed, so a regression
stops the pipeline rather than scrolling past.

| Metric | What it means |
|--------|----------------|
| `http_req_failed` | The share of requests that failed. Near zero everywhere. |
| `checks` | The share of assertions that held. Near one everywhere. |
| `http_req_duration` | The latency budget for the endpoint, p95 and p99. |
| `dropped_iterations` | Iterations k6 could not start. Must be zero. |

### Run Summaries

Each run writes its k6 summary to `test/load/results/`. The directory is
gitignored; the file is the evidence of what the run did, including the
metric values, the checks and the threshold results.

### Notes for Anyone Adding a Script

- k6 empties the per-VU cookie jar between iterations, so a script that
  needs a session has to sign in during the iteration that uses it.
- k6 counts every status of 400 and above as a failed request. A script
  that expects a refusal widens the accepted set with
  `http.setResponseCallback`, so a refusal does not read as a failure while
  a 5xx still does.
- The shared helpers in `test/load/scripts/lib/` hold the environment
  handling (`config.js`), the session helper (`auth.js`), the payload matrix
  (`payloads.js`), the check builders (`checks.js`) and the NDJSON parser
  (`ndjson.js`).
  The expected statuses live with the payloads, so a behaviour change shows
  up in one place.

### Load Test Observability

By default a load run is fully offline: no collector, no network calls, no
change in what the rig does. Add `WITH_OBSERVABILITY=1` to also stream the run
into New Relic, so the run shows up on the `detectai-web (loadtest)` board
instead of the prod one.

```bash
export NEW_RELIC_LICENSE_KEY="eu01..."   # ingest key, never commit
make load-test WITH_OBSERVABILITY=1 VUS=10 DURATION=2m
```

This starts an OpenTelemetry collector alongside the rig, points the app's OTLP
exporter at it, and adds the Postgres, Redis and RabbitMQ exporters so the
board's Infra page has datastore depth. The collector tags everything with
`deployment.environment = loadtest`, so a load run never pollutes the prod
boards and never triggers the prod alerts.

Without a license key the collector retries and drops while the app keeps
serving, so a failed export never fails a run.


## Common Testing Issues

### "Docker not running"

**Problem:** The HA integration tests fail because Docker isn't running.

**Solution:** Start Docker. The other suites do not need it locally, though CI runs one container-backed test in the backend integration tier.

### "Port already in use"

**Problem:** Tests fail because another process is using the port.

**Solution:** Stop the other process or use a different port.

### "Tests are slow"

**Problem:** Tests take too long to run.

**Solution:**
- Run only unit tests for quick feedback
- Check if tests are doing unnecessary work
- Remember the HA suite starts a three-node broker and is slow by design

### "Flaky tests"

**Problem:** Tests sometimes pass, sometimes fail.

**Solution:**
- Check for race conditions
- Ensure tests clean up after themselves
- Use proper test isolation
- Avoid timing-dependent assertions

### "Module not found"

**Problem:** Tests can't find imported modules.

**Solution:**
- Check `tsconfig.json` paths
- Run `pnpm install` to ensure dependencies are installed
- Check `vite-tsconfig-paths` configuration

## Best Practices

1. **Write tests before fixing bugs** — Ensure the bug exists, then write a test that catches it
2. **Keep tests simple** — Each test should test one thing
3. **Use descriptive names** — Test names should explain what they test
4. **Clean up after tests** — Don't leave test data in databases
5. **Run tests frequently** — Don't wait until the end to test
6. **Mock external services** — Don't depend on real APIs in unit tests
7. **Use MSW for API mocking** — Intercept network requests cleanly
8. **Test edge cases** — Empty inputs, errors, timeouts

## Related Documentation

- [Architecture](../concepts/architecture.md) - How components are structured
- [Configuration](../getting-started/configuration.md) - Test environment settings
- [Observability](../operations/observability.md) - Monitor test performance
- [Rate Limiting](../components/rate-limiting.md) - The limits the load scripts exercise
