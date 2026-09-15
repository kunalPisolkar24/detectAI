# Request Flows

This document explains how user requests are processed by the Web service. We'll look at each main operation and see what happens step by step.

## AI Text Analysis (Streaming)

When a user submits text for AI detection, the request flows through a streaming pipeline:

```mermaid
sequenceDiagram
    participant User as User Browser
    participant Web as Web Service<br/>(Next.js API)
    participant RateLimit as Rate Limiter<br/>(Redis)
    participant Inference as Inference Service<br/>(gRPC)
    participant Queue as RabbitMQ

    User->>Web: POST /api/chat/analyze/stream
    Web->>Web: Authenticate session
    Web->>Web: Validate request (Zod)
    Web->>RateLimit: Check daily usage
    RateLimit-->>Web: Allowed / Denied

    alt Rate limit exceeded
        Web-->>User: 429 Too Many Requests
    else Allowed
        Web->>Inference: gRPC Detect(text, model)
        Inference-->>Web: Analysis result
        Web->>Queue: Publish usage event
        Web-->>User: NDJSON stream (started → progress → final)
    end
```

**What happens:**
1. User clicks "Analyze" with text content
2. Browser sends POST request to `/api/chat/analyze/stream`
3. API route authenticates the session (NextAuth JWT)
4. Request body is validated with Zod schema
5. Rate limiter checks daily usage against Redis
6. If allowed, the inference service is called via gRPC
7. Analysis result is streamed back as NDJSON chunks
8. Usage event is published to RabbitMQ for billing

**Why streaming?**
- User sees progress immediately (started → progress → final events)
- Large documents can take time; streaming keeps the user informed
- NDJSON format allows chunked transfer encoding

## Chat Message Flow

When a user sends a message in a chat conversation:

```mermaid
sequenceDiagram
    participant User as User Browser
    participant Web as Web Service<br/>(Next.js)
    participant ChatSvc as Chats Service<br/>(gRPC)
    participant Inference as Inference Service<br/>(gRPC)

    User->>Web: Send message
    Web->>Web: Authenticate session
    Web->>ChatSvc: SaveMessage(user message)
    par Parallel processing
        Web->>Inference: Detect(content, model)
        and
        Web->>ChatSvc: SaveMessage(assistant analysis)
    end
    Inference-->>Web: Analysis result
    Web-->>User: Updated chat with analysis
```

**What happens:**
1. User types a message and clicks send
2. Web service authenticates the user
3. User message is saved to the Chats service via gRPC
4. In parallel, the inference service analyzes the text
5. Analysis result is saved as an assistant message
6. Updated chat is returned to the user

## Health Check Flow

When Kubernetes or a load balancer checks if the service is ready:

```mermaid
sequenceDiagram
    participant K8s as Kubernetes/Load Balancer
    participant Web as Web Service
    participant PG as PostgreSQL
    participant Redis as Redis
    participant Services as Backend Services

    K8s->>Web: GET /readyz
    par Required checks
        Web->>PG: SELECT 1
        and
        Web->>Redis: PING
    end
    par Optional checks
        Web->>Services: gRPC Health (Inference)
        and
        Web->>Services: gRPC Health (Chats)
        and
        Web->>Services: HTTP Health (Doc Parser)
        and
        Web->>Services: HTTP Health (Payment Gateway)
    end
    PG-->>Web: OK
    Redis-->>Web: PONG
    Services-->>Web: Status
    Web-->>K8s: 200 (ready) / 503 (not ready)
```

**What happens:**
1. Kubernetes calls `/readyz` every few seconds
2. Web service runs all checks in parallel
3. **Required checks**: PostgreSQL and Redis must be healthy
4. **Optional checks**: Backend services (inference, chats, doc parser, payments)
5. If required checks pass → 200 OK (ready)
6. If optional checks fail → 200 OK with `degraded` status
7. If required checks fail → 503 Not Ready

**Why two types of checks?**
- Required checks ensure the app can serve basic requests
- Optional checks indicate degraded functionality (can still serve UI)
- Prevents one failing backend from blocking all deployments

## Authentication Flow

When a user signs up or logs in:

```mermaid
sequenceDiagram
    participant User as User Browser
    participant Web as Web Service<br/>(NextAuth)
    participant DB as PostgreSQL

    alt Email/Password Login
        User->>Web: POST /api/auth/callback/credentials
        Web->>DB: Find user by email
        DB-->>Web: User record
        Web->>Web: Compare password (bcrypt)
        Web-->>User: JWT session cookie
    else Google OAuth
        User->>Web: Click "Sign in with Google"
        Web->>User: Redirect to Google
        User->>Web: Google callback with code
        Web->>Web: Exchange code for tokens
        Web->>DB: Find or create user
        Web-->>User: JWT session cookie
    else GitHub OAuth
        User->>Web: Click "Sign in with GitHub"
        Web->>User: Redirect to GitHub
        User->>Web: GitHub callback with code
        Web->>Web: Exchange code for tokens
        Web->>DB: Find or create user
        Web-->>User: JWT session cookie
    end
```

**What happens:**
1. User enters credentials or clicks OAuth button
2. NextAuth handles the authentication flow
3. For credentials: password is compared with bcrypt
4. For OAuth: code is exchanged for tokens, user is found/created
5. JWT session cookie is set (1 hour expiry)
6. User is redirected to the app

## Rate Limiting Flow

When a user makes an analysis request:

```mermaid
sequenceDiagram
    participant Web as Web Service
    participant Redis as Redis
    participant DB as PostgreSQL
    participant RabbitMQ as RabbitMQ

    Web->>Redis: GET daily usage key
    alt Redis available
        Redis-->>Web: Current count
        Web->>Web: Check against limit (100/day for free tier)
    else Redis unavailable
        Web->>DB: Fallback query
        DB-->>Web: Current count
    end

    alt Under limit
        Web-->>User: Allow request
        Web->>Redis: INCR daily usage
        Web->>RabbitMQ: Publish usage event
    else Over limit
        Web-->>User: 429 Rate Limit Exceeded
    end
```

**What happens:**
1. Rate limiter reads daily usage from Redis
2. If Redis is unavailable, falls back to PostgreSQL
3. Compares usage against tier limit (100/day for free users)
4. If under limit: allows request, increments counter, publishes event
5. If over limit: returns 429 error

**Why Redis + PostgreSQL fallback?**
- Redis is fast for real-time counting
- PostgreSQL ensures usage is persisted for billing
- Fallback ensures rate limiting works even if Redis is down

## Summary

| Operation | How It Works | Speed |
|-----------|--------------|-------|
| AI Analysis | gRPC to inference service, streamed back | Fast (streaming) |
| Chat Message | gRPC to chats service + inference | Fast (parallel) |
| Health Check | Parallel probes to all dependencies | Fast (cached) |
| Authentication | NextAuth with JWT/cookies | Fast (in-memory) |
| Rate Limiting | Redis counter with DB fallback | Fast (Redis) / Medium (DB) |

## Next Steps

- [API Routes](../components/api-routes.md) - Complete API reference
- [Backend Services](../components/services.md) - How services connect
- [Health Checks](../operations/health.md) - Health probe details
