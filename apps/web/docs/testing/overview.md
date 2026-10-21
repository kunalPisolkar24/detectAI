# Testing

This document explains how to test the Web service. Testing ensures the service works correctly and catches bugs before they reach users.

## Why Test?

Testing helps you:
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
npm run test:run

# Run in watch mode (re-runs on file changes)
npm run test
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

**What they are:** Tests that check multiple parts working together with real databases.

**When to use:** Before committing code.

**Speed:** Medium (minutes).

**Dependencies:** Docker (for real databases).

```bash
# Run backend integration tests
npm run test:integration:backend

# Run HA integration tests
npm run test:integration:ha
```

**Example:** Testing that saving a message and retrieving it works end-to-end.

### E2E Tests

**What they are:** Tests that check the full user flow in a real browser.

**When to use:** Before deploying to production.

**Speed:** Slower (minutes).

**Dependencies:** Playwright browser binaries.

```bash
# Run E2E tests (requires preview build running)
npm run test:e2e
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
| Quick check | Unit tests |
| Before deployment | All tests |

## Test Structure

```
apps/web/
├── features/
│   └── chat/
│       └── __tests__/           # Feature-specific unit tests
│           ├── mappers.test.ts
│           └── ...
├── test/
│   ├── custom-renderer.tsx      # Custom test renderer
│   ├── example.test.ts          # Example test
│   ├── handlers/
│   │   └── chat-handlers.ts     # MSW handlers for API mocking
│   ├── infrastructure/
│   │   └── ...                  # Infrastructure tests
│   ├── load/
│   │   ├── scripts/                # k6 load test scripts
│   │   │   ├── lib/                # Shared config, payloads, checks
│   │   │   └── *.k6.js             # One script per scenario
│   │   ├── mock-server/            # gRPC and HTTP doubles
│   │   ├── seed/                   # Seeds the accounts the scripts sign in with
│   │   └── results/                # Run summaries (gitignored)
│   ├── mocks/
│   │   └── ...                  # Test mocks
│   ├── msw-server.ts            # MSW server setup
│   ├── prisma-mock.ts           # Prisma mock
│   ├── setup-node.ts            # Node test setup
│   ├── setup.ts                 # General test setup
│   └── test-utils.tsx           # Test utilities
└── e2e/
    ├── auth.spec.ts             # Authentication E2E tests
    ├── chat.spec.ts             # Chat E2E tests
    └── upgrade.spec.ts          # Upgrade E2E tests
```

## Writing Tests

### Unit Test Example

```typescript
import { describe, it, expect, vi } from "vitest"
import { mapGrpcMessageToDomain } from "../utils/mappers"

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
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "@prisma/client"

describe("Database Operations", () => {
  const prisma = new PrismaClient()

  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it("should create and retrieve a user", async () => {
    const user = await prisma.user.create({
      data: {
        email: "test@example.com",
        name: "Test User",
      },
    })

    expect(user.id).toBeDefined()
    expect(user.email).toBe("test@example.com")

    const found = await prisma.user.findUnique({
      where: { id: user.id },
    })

    expect(found).toEqual(user)
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

`test/custom-renderer.tsx` provides a custom render function with providers:

```typescript
import { render } from "@testing-library/react"
import { SessionProvider } from "next-auth/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

export function customRender(ui: React.ReactElement) {
  const queryClient = new QueryClient()

  return render(
    <SessionProvider session={null}>
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    </SessionProvider>
  )
}
```

### MSW (Mock Service Worker)

MSW intercepts network requests for testing:

```typescript
// test/handlers/chat-handlers.ts
import { http, HttpResponse } from "msw"

export const handlers = [
  http.post("/api/chat/analyze/stream", () => {
    return HttpResponse.json({
      type: "final",
      result: { model: "spark", label: "Human", confidence: 0.95 },
    })
  }),
]
```

### Prisma Mock

`test/prisma-mock.ts` provides a mock Prisma client:

```typescript
import { mockDeep } from "vitest-mock-extended"
import { PrismaClient } from "@prisma/client"

export const prismaMock = mockDeep<PrismaClient>()
```

## Test Configuration

### Vitest

Unit and integration tests use Vitest:

```bash
# Unit tests (default config)
npm run test:run

# Backend integration tests (Node config)
npm run test:integration:backend

# HA integration tests (Node HA config)
npm run test:integration:ha
```

### Playwright

E2E tests use Playwright:

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npx playwright test e2e/chat.spec.ts

# Run in headed mode (see browser)
npx playwright test --headed
```

## Load Testing

Load tests use **k6** to check performance under heavy traffic, and to pin
down what the service does with the requests it does *not* accept.

### Running Load Tests

The `make load-test` target brings up a self-contained rig (throwaway Postgres
and Redis, a mock backend server, a seeder and k6) and runs one script
against it.

```bash
# Default script (landing page)
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
  handling, the payload matrix, the check builders and the NDJSON parser.
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

**Problem:** Integration tests fail because Docker isn't running.

**Solution:** Start Docker Desktop or run `dockerd`.

### "Port already in use"

**Problem:** Tests fail because another process is using the port.

**Solution:** Stop the other process or use a different port.

### "Tests are slow"

**Problem:** Tests take too long to run.

**Solution:**
- Run only unit tests for quick feedback
- Use test tags to run specific tests
- Check if tests are doing unnecessary work

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
- Run `npm install` to ensure dependencies are installed
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
