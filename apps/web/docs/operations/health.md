# Health Checks

This document explains how the Web service monitors its own health and how you can check if it's working properly.

## Why Health Checks Matter

Health checks help you know:
- Is the service running?
- Can it connect to its databases?
- Is it ready to handle requests?
- Are backend services available?

This is important for:
- **Kubernetes** — Decides when to restart pods and route traffic
- **Load balancing** — Route traffic only to healthy instances
- **Debugging** — Quickly identify what's broken

## How Health Checks Work

The service has two types of health checks:

### 1. Liveness Probe — `/api/healthz`

**What it does:** Always returns 200 if the process is alive. Used by Kubernetes to know if the pod should be restarted.

```mermaid
graph TB
    K8s[Kubernetes] --> Healthz["/api/healthz"]
    Healthz --> Process{Process alive?}
    Process -->|Yes| OK[200 OK]
    Process -->|No| Restart[Pod Restarted]
```

**What it checks:** Nothing — just confirms the process is running.

**Why it's simple:** If the process is stuck (deadlock, infinite loop), Kubernetes will restart it. This probe should never fail unless the process is truly dead.

**Response:**

```json
{
  "status": "ok"
}
```

### 2. Readiness Probe — `/api/readyz`

**What it does:** Checks if the service can handle requests by testing all dependencies.

```mermaid
graph TB
    K8s[Kubernetes] --> Reada["/api/readyz"]
    Reada --> PG[PostgreSQL<br/>SELECT 1]
    Reada --> Redis[Redis<br/>PING]
    Reada --> Inference[Inference Service<br/>gRPC Health]
    Reada --> Chats[Chats Service<br/>gRPC Health]
    Reada --> DocParser[Document Parser<br/>HTTP Health]
    Reada --> Payments[Payment Gateway<br/>HTTP Health]

    PG --> Result{All required OK?}
    Redis --> Result
    Inference --> Optional[Optional]
    Chats --> Optional
    DocParser --> Optional
    Payments --> Optional

    Result -->|Yes| Ready[200 OK]
    Result -->|No| NotReady[503 Not Ready]
    Optional --> Degraded[Degraded Status]
```

**Required checks** (must pass for 200 OK):

| Check | Protocol | Timeout | What It Tests |
|-------|----------|---------|---------------|
| PostgreSQL | SQL (`SELECT 1`) | 8s | Database connectivity |
| Redis | `PING` | 8s | Cache connectivity |

**Optional checks** (degraded mode if they fail):

| Check | Protocol | Timeout | What It Tests |
|-------|----------|---------|---------------|
| Inference Service | gRPC health | 2s | AI analysis availability |
| Chats Service | gRPC health | 2s | Chat storage availability |
| Document Parser | HTTP `/api/v1/health` | 2s | File extraction availability |
| Payment Gateway | HTTP `/readyz` | 2s | Payment processing availability |

The optional checks give up sooner than the required ones. Every check has the same 8-second outer bound, but the optional ones also carry their own shorter inner deadline — a 2-second `AbortController` on the two HTTP probes and a 2-second deadline on each gRPC probe. A slow backend therefore degrades the app quickly instead of holding up the whole probe.

**The whole suite is capped at 20 seconds.** Each check is individually bounded *and* the suite has its own outer timeout, so a probe can never hang — a partial stack with no inference service still answers, with `degraded`.

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
    "analysis": { "status": "ok", "checks": { "inference": { "status": "ok", "latencyMs": 8 } } }
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
    "documentParser": { "status": "ok", "latencyMs": 45 },
    "paymentGateway": { "status": "ok", "latencyMs": 30 },
    "analysis": { "status": "ok", "checks": { "inference": { "status": "ok", "latencyMs": 8 } } }
  }
}
```

All five checks are always present in the response, whatever the outcome.

**HTTP status codes:**

| Status | Meaning |
|--------|---------|
| `200` | The required checks passed. The body's `status` says `"ready"` or `"degraded"` |
| `503` | A required check failed. The body's `status` says `"not_ready"` |

A `degraded` result is still a `200`. Kubernetes keeps routing traffic to a degraded pod, because the core routes — chat, auth, billing — still work.

## Why Two Types of Checks?

| Probe | Purpose | Failure Action |
|-------|---------|----------------|
| Liveness | Detect stuck processes | Kubernetes restarts the pod |
| Readiness | Detect unavailable services | Kubernetes removes pod from load balancer |

**Why required vs optional?**
- Required checks ensure the app can serve basic requests
- Optional checks indicate degraded functionality (can still serve UI)
- Prevents one failing backend from blocking all deployments

## Caching

The PostgreSQL and Redis results are cached for 10 seconds:

```typescript
const PG_REDIS_TTL_MS = 10_000  // 10 seconds
```

**Only those two are cached.** A cold connection to either can take several seconds, and a probe runs every few seconds, so caching them keeps the probe cheap. The three optional checks — which probe four services between them — are probed on every request, because they are fast and you want them to be current.

This means:
- First probe after the cache expires: PostgreSQL and Redis are actually queried
- Subsequent probes within 10 seconds: the PostgreSQL and Redis results are reused
- The document parser, payment gateway and both gRPC services are probed every time

## Preview Mode

In preview mode (`ENV_TYPE=preview`), all checks are skipped:

```json
{
  "status": "ready",
  "mode": "preview",
  "checks": {
    "postgres": { "status": "skipped" },
    "redis": { "status": "skipped" },
    "documentParser": { "status": "skipped" },
    "paymentGateway": { "status": "skipped" },
    "analysis": { "status": "skipped" }
  }
}
```

The response is a `200`. **Why skip in preview?** No real databases or services are running, and a preview deployment should not be pulled out of rotation because nothing is behind it.

## Kubernetes Configuration

### Liveness Probe

```yaml
livenessProbe:
  httpGet:
    path: /api/healthz
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3
```

### Readiness Probe

```yaml
readinessProbe:
  httpGet:
    path: /api/readyz
    port: 3000
  initialDelaySeconds: 15
  periodSeconds: 10
  timeoutSeconds: 25
  failureThreshold: 3
```

**Keep `timeoutSeconds` above the app's own 20-second suite cap.** If the probe timeout is lower than the cap, Kubernetes gives up on the request before the service can report which check timed out, and the probe fails without saying why.

## Monitoring Health

### What to Monitor

| Metric | Warning | Critical |
|--------|---------|----------|
| Service up | Down > 1 min | Down > 2 min |
| PostgreSQL latency | > 1s | > 5s |
| Redis latency | > 100ms | > 1s |
| Backend services | 1 degraded | All degraded |

### Health Check Commands

```bash
# Check liveness
curl http://localhost:3000/api/healthz

# Check readiness
curl http://localhost:3000/api/readyz

# Check with pretty JSON
curl -s http://localhost:3000/api/readyz | jq .

# Check specific dependency
curl -s http://localhost:3000/api/readyz | jq .checks.postgres
```

## Troubleshooting

**Service reports `not_ready`?**
- Check if PostgreSQL is running
- Check if Redis is running
- Verify network connectivity
- Look at service logs for connection errors

**Service reports `degraded`?**
- Check which optional service is failing
- Verify backend services are deployed
- Check network connectivity to backends
- Review backend service logs

**Health check timeout?**
- Check database performance
- Verify no network issues
- Look at service logs
- The optional checks give up after 2s and the suite after 20s

**Probe causing high load?**
- PostgreSQL and Redis results are cached for 10 seconds
- Each check has its own timeout: 8s for the required ones, 2s for the optional ones
- The whole suite has a 20-second cap
- Consider adjusting probe intervals

**A check reports `skipped` outside preview mode?**
Only the optional checks can be skipped, and only in preview mode. If you see `skipped` in production, the service is running with `ENV_TYPE=preview`, which also means it is serving mock data.

## Related Documentation

- [Configuration](../getting-started/configuration.md) - Health check settings
- [Observability](observability.md) - Metrics and alerts
- [Architecture](../concepts/architecture.md) - How components connect
- [Backend Services](../components/services.md) - What the optional checks probe
