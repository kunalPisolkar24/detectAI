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
│   │   └── chat-api.k6.js       # k6 load test scripts
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

Load tests use **k6** to check performance under heavy traffic.

### Running Load Tests

```bash
# Smoke test (quick check)
k6 run test/load/chat-api.k6.js --vus 1 --duration 10s

# Load test (realistic traffic)
k6 run test/load/chat-api.k6.js --vus 10 --duration 2m

# Stress test (find breaking point)
k6 run test/load/chat-api.k6.js --vus 50 --duration 5m
```

### Load Test Scenarios

| Scenario | Virtual Users | Duration | Purpose |
|----------|---------------|----------|---------|
| Smoke | 1 | 10 seconds | Quick sanity check |
| Load | 10 | 2 minutes | Realistic traffic |
| Stress | 50 | 5 minutes | Find breaking point |

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
