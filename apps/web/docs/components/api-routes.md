# API Routes

This document explains the API routes exposed by the Web service. These are Next.js API routes that run server-side and handle backend orchestration.

## Overview

The Web service exposes API routes under `/api/`. These routes handle:

- Health checks and monitoring
- AI text analysis
- Backend service proxying
- Authentication (via NextAuth)

```mermaid
graph LR
    Client[Browser] --> Healthz[/api/healthz]
    Client --> Reada[/api/readyz]
    Client --> Metrics[/api/metrics]
    Client --> Analyze[/api/chat/analyze/stream]
    Client --> Auth[/api/auth/*]
    Client --> Services[/api/services/*]
```

## Health Endpoints

### Liveness Probe — `/api/healthz`

**What it does:** Always returns 200 if the process is alive. Used by Kubernetes to know if the pod should be restarted.

**Request:**

```bash
curl http://localhost:3000/api/healthz
```

**Response:**

```json
{
  "status": "ok"
}
```

**What each field means:**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"ok"` if the process is running |

**Why it's simple:** A liveness probe should never fail unless the process is stuck. It doesn't check dependencies — that's the readiness probe's job.

### Readiness Probe — `/api/readyz`

**What it does:** Checks if the service can handle requests by testing all dependencies.

**Request:**

```bash
curl http://localhost:3000/api/readyz
```

**Response (all healthy):**

```json
{
  "status": "ready",
  "checks": {
    "postgres": { "status": "ok", "latencyMs": 12 },
    "redis": { "status": "ok", "latencyMs": 3 },
    "documentParser": { "status": "ok", "latencyMs": 45 },
    "paymentGateway": { "status": "ok", "latencyMs": 30 },
    "analysis": {
      "status": "ok",
      "checks": {
        "inference": { "status": "ok", "latencyMs": 8 },
        "chatService": { "status": "ok", "latencyMs": 6 }
      }
    }
  }
}
```

**Response (degraded — optional service down):**

```json
{
  "status": "degraded",
  "checks": {
    "postgres": { "status": "ok", "latencyMs": 12 },
    "redis": { "status": "ok", "latencyMs": 3 },
    "documentParser": { "status": "error", "error": "health 503" },
    "paymentGateway": { "status": "ok", "latencyMs": 30 },
    "analysis": { "status": "ok", "checks": { ... } }
  }
}
```

**Response (not ready — required service down):**

```json
{
  "status": "not_ready",
  "checks": {
    "postgres": { "status": "error", "error": "connection refused" },
    "redis": { "status": "ok", "latencyMs": 3 },
    ...
  }
}
```

**HTTP status codes:**

| Status | Meaning |
|--------|---------|
| `200` | Ready (required checks pass) |
| `503` | Not ready (required checks fail) |

**Check types:**

| Check | Required | Timeout | What It Tests |
|-------|----------|---------|---------------|
| `postgres` | Yes | 8s | PostgreSQL connection (`SELECT 1`) |
| `redis` | Yes | 8s | Redis connection (`PING`) |
| `documentParser` | No | 8s | Document parser HTTP health |
| `paymentGateway` | No | 8s | Payment gateway HTTP readyz |
| `analysis` | No | 8s | Inference + Chats gRPC health |

**Why cached?** Results are cached for 10 seconds to avoid overwhelming dependencies with every probe.

### Prometheus Metrics — `/api/metrics`

**What it does:** Exposes Prometheus metrics for scraping.

**Request:**

```bash
curl http://localhost:3000/api/metrics
```

If `PROMETHEUS_WEB_SCRAPE_TOKEN` is set, requires Bearer token:

```bash
curl -H "Authorization: Bearer your-token" http://localhost:3000/api/metrics
```

**Response:** Prometheus text format with all application metrics.

## AI Analysis Endpoint

### Streaming Analysis — `POST /api/chat/analyze/stream`

**What it does:** Analyzes text for AI-generated content and streams results back as NDJSON.

**Request:**

```bash
curl -X POST http://localhost:3000/api/chat/analyze/stream \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=..." \
  -d '{
    "content": "The text to analyze for AI detection",
    "model": "spark"
  }'
```

**Request fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Text to analyze (max length varies by tier) |
| `model` | string | No | Detection model: `"spark"` or `"flare"` (default: `"spark"`) |

**Response (NDJSON stream):**

```
{"type":"started","totalChars":45,"totalChunks":1}
{"type":"progress","processedChunks":1,"totalChunks":1}
{"type":"final","result":{"model":"spark","label":"Human","confidence":0.95,"scores":{"ai":0.05,"human":0.95},"highlights":[]}}
```

**Stream events:**

| Event | Fields | Description |
|-------|--------|-------------|
| `started` | `totalChars`, `totalChunks` | Analysis has begun |
| `progress` | `processedChunks`, `totalChunks` | Processing is underway |
| `final` | `result` | Analysis complete with full result |

**Error responses:**

| Status | Meaning |
|--------|---------|
| `400` | Invalid request body or text too long |
| `401` | Not authenticated |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

**Load testing:** Send `X-Internal-Key` header matching `INTERNAL_API_KEY` to bypass authentication and use a shared load-test user.

## Backend Service Proxies

These endpoints proxy health checks to backend services:

### Inference Service — `GET /api/services/analysis/status`

```bash
curl http://localhost:3000/api/services/analysis/status
```

### Document Parser — `GET /api/services/document-parser/status`

```bash
curl http://localhost:3000/api/services/document-parser/status
```

### Payment Gateway — `GET /api/services/payment-gateway/status`

```bash
curl http://localhost:3000/api/services/payment-gateway/status
```

## Authentication Routes

All NextAuth routes are automatically available under `/api/auth/`:

| Route | Purpose |
|-------|---------|
| `/api/auth/signin` | Sign in page |
| `/api/auth/signout` | Sign out |
| `/api/auth/session` | Get current session |
| `/api/auth/csrf` | Get CSRF token |
| `/api/auth/callback/credentials` | Email/password login |
| `/api/auth/callback/google` | Google OAuth callback |
| `/api/auth/callback/github` | GitHub OAuth callback |

See [Authentication](auth.md) for details.

## Common Patterns

### Server-Side Authentication

All API routes that require authentication use NextAuth's `getServerSession`:

```typescript
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/config/auth-options"

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // ... handle request
}
```

### Request Validation

Request bodies are validated with Zod schemas:

```typescript
import { ChatAnalyzeRequestSchema } from "@/lib/domain/schemas/chat"

const body = await request.json()
const parsed = ChatAnalyzeRequestSchema.safeParse(body)
if (!parsed.success) {
  return NextResponse.json({ error: "Invalid request payload" }, { status: 400 })
}
```

### Preview Mode

In preview mode, most checks are skipped and mock data is returned:

```typescript
if (isPreviewMode()) {
  // Return mock response
}
```

## Tips

1. **Use `force-dynamic`** — Health and metrics routes use `export const dynamic = "force-dynamic"` to prevent caching
2. **Handle errors gracefully** — Check error codes and return meaningful messages
3. **Use streaming for long operations** — NDJSON keeps users informed during analysis
4. **Cache health check results** — The readiness probe caches results for 10 seconds
5. **Use `INTERNAL_API_KEY` for load tests** — Bypasses auth for automated testing

## Related Documentation

- [Health Checks](../operations/health.md) - Health probe details
- [Observability](../operations/observability.md) - Metrics and monitoring
- [Request Flows](../concepts/request-flows.md) - How requests move through the system
