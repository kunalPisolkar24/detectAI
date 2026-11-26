# Request Flow

This is the path from a ConnectRPC frame to a stored resource. It is the same path for all eight RPCs — the procedure name changes what runs in the middle, not the guard rails at the edges.

## The chain, in order

Gin registers three things before the Connect handler: `otelgin` (wired only when telemetry is on), `gin.Logger()`, and `gin.Recovery()`. The trace middleware is first on purpose — its span brackets a panic the recovery absorbs, so a crash is not left as an open span.

Inside the Connect handler, four interceptors wrap every RPC. The first is outermost: it acts first on the way in and last on the way out.

| Order | Interceptor | Job | Refusal |
|-------|-------------|-----|---------|
| 1 | telemetry | opens the procedure span, counts the answer on the way out — even on panic | never refuses |
| 2 | timeout | `context.WithTimeout` for 8 s | `deadline_exceeded` |
| 3 | auth | `x-api-key` constant-time compare, then `x-user-id` | `unauthenticated` |
| 4 | rate limit | `read` / `create` / `write` scopes, all eight procedures | `resource_exhausted` + retry metadata |

The handler runs last: it re-reads the owner from the context, validates, calls the service, and maps the domain error onto a Connect code. On a cache miss the service collapses same-process duplicates, takes a Redis fill lock, re-reads the cache (including a short-lived `not_found` marker), and only then queries Mongo — see [Cache](cache.md).

## The admission flow

```mermaid
graph TB
    START(["start: an RPC arrives"]) --> SPAN["telemetry opens the span"]
    SPAN --> DEAD{"8 s budget still live?"}
    DEAD -->|"no"| RDEAD["deadline_exceeded"]
    DEAD -->|"yes"| KEY{"x-api-key matches<br/>and x-user-id present?"}
    KEY -->|"no"| RAUTH["unauthenticated"]
    KEY -->|"yes"| BUDGET{"burst budget left<br/>in the procedure's scope?"}
    BUDGET -->|"no"| RRATE["resource_exhausted<br/>+ retry-after-ms"]
    BUDGET -->|"yes"| VALID{"payload fields valid?"}
    VALID -->|"no"| RINV["invalid_argument"]
    VALID -->|"yes"| OWN{"chat exists<br/>and is owned?"}
    OWN -->|"no"| RNF["not_found"]
    OWN -->|"yes"| OK["service reads the cache,<br/>writes Mongo, invalidates keys"] --> END(["end: 200 + resource"])
    RDEAD --> END
    RAUTH --> END
    RRATE --> END
    RINV --> END
    RNF --> END
```

Two refusals are deliberately not hard failures: a Redis fault makes the rate-limit check **fail open** (the RPC proceeds, the fault is counted), and a cache fault never fails an RPC — see [Cache](cache.md).

## The admission conversation

```mermaid
sequenceDiagram
    autonumber
    participant C as caller
    participant T as telemetry interceptor
    participant A as auth interceptor
    participant L as rate-limit interceptor
    participant H as handler
    participant S as ChatService
    participant R as cache + repository

    C->>T: RPC + headers
    T->>T: TrackRPC — span opens
    T->>A: next
    A->>A: constant-time key compare, read owner
    A->>L: next, owner in context
    L->>L: Consume(owner, scope, limit) — 250 ms deadline
    L->>H: next, or resource_exhausted
    H->>S: validated use case
    S->>R: cache read-through / Mongo write / invalidation
    R-->>S: the stored result
    S-->>H: domain result
    H-->>T: Connect code + resource
    T->>T: RecordRPC + span closes with final status
    T-->>C: response
    note over T,L: refusals from auth and the limiter are counted too - telemetry sits outside them
```

## The Connect face

The wire layer owns statuses, not business logic. Every RPC method calls `OwnerFrom(ctx)` first; the private context key the auth interceptor wrote is the only source of identity.

```mermaid
classDiagram
    class Handler {
        -service: Service
        +CreateChat(ctx, req)
        +GetChat(ctx, req)
        +ListChats(ctx, req)
        +RenameChat(ctx, req)
        +DeleteChat(ctx, req)
        +SaveUserMessage(ctx, req)
        +SaveAnalysisMessage(ctx, req)
        +GetChatHistory(ctx, req)
    }
    class TelemetryInterceptor {
        +Wrap(next)
    }
    class TimeoutInterceptor {
        -timeout: Duration
        +Wrap(next)
    }
    class AuthInterceptor {
        -apiKey: string
        +Wrap(next)
        +OwnerFrom(ctx)
        -credentialMatches(got, want)
    }
    class RateLimitInterceptor {
        -limiter: Limiter
        -limits: Limits
        +Wrap(next)
    }
    class Limits {
        +Read: int
        +Create: int
        +Write: int
    }
    class toConnectError {
        <<function>>
    }
    Handler ..> toConnectError : every domain error maps once
    RateLimitInterceptor o--> Limits
    note for AuthInterceptor "ConstantTimeCompare on x-api-key - missing and wrong are indistinguishable"
    note for AuthInterceptor "x-user-id is trusted only because the key authenticated its holder"
    note for RateLimitInterceptor "all eight procedures have a scope - reads share one generous 600/min budget"
    note for TelemetryInterceptor "outermost: a panic records internal, closes the span, and is re-raised for gin.Recovery"
    note for toConnectError "domain errors: not_found · invalid_argument · failed_precondition · unavailable · internal"
```

The handler also owns the proto↔domain mapping (one function per shape) and the refusal metadata: an over-limit answer carries `retry-after-ms`, `x-ratelimit-limit`, and `x-ratelimit-remaining=0`. Refusals are logged once per exhausted window, and owner ids are hashed before logging.

## The use cases

```mermaid
classDiagram
    class Service {
        <<interface>>
        +8 methods
    }
    class ChatService {
        -repo: Repository
        -cache: Cache
        -logger: slog.Logger
        -telemetry: Telemetry
    }
    class ValidationError {
        +Field: string
        +Reason: string
    }
    class cachedChat {
        <<function>>
    }
    class headPage {
        <<function>>
    }
    class invalidateChat {
        <<function>>
    }
    Service <|.. ChatService
    ChatService ..> ValidationError : rejections become a metric
    ChatService o--> cachedChat
    ChatService o--> headPage
    ChatService o--> invalidateChat
    note for ChatService "validation → cache-aside read → repository; writes go to Mongo then invalidate"
    note for cachedChat "ownership is rechecked on a hit - a cached doc from another owner is not_found"
    note for headPage "the first ~50 messages are cached (DefaultHistoryLimit); cursor pages read Mongo"
    note for ValidationError "the field name rides into chats_validation_rejections_total"
```

## Validation and bounds

Validation is pure and lives at the service boundary; no driver or wire type reaches it.

| Rule | Limit / condition |
|------|-------------------|
| Title | non-blank, ≤ 200 runes; derived from the initial message on create |
| Chat id | non-blank |
| Message content | non-blank, ≤ 100,000 runes |
| Role | `user` on user messages, `assistant` on analysis messages |
| Analysis | required on analysis messages; `source_message_id` non-blank; state one of four; model `spark` or `flare` |
| State payload | `COMPLETED` requires `analysis`; `FAILED` requires `error` |
| Page limits | history default 50 / cap 200; chat list default 50 / cap 200 |

A rejected field answers `invalid_argument` naming the field, and increments `chats_validation_rejections_total`. A malformed or foreign-chat cursor is also `invalid_argument`, but through `ErrInvalidCursor` — [Data Model](data-model.md) covers the codec.

## Next Steps

- **[RPC API](../reference/rpc-api.md)** — the full code table and rate-limit scopes
- **[Cache](cache.md)** — the read-through and failure semantics this path relies on
- **[Observability](observability.md)** — where each step's record is taken
