# Cache

Redis is a read-through overlay on MongoDB, never the source of truth. Chats keys live behind a `chats:` prefix on a shared instance, every key carries a TTL, and no cache fault can fail an RPC.

## The keys

| Key pattern | Value | TTL | Serves | Invalidated by |
|-------------|-------|-----|--------|----------------|
| `chats:chat:<id>` | chat meta (owner, title, updated_at) | 10m | ownership check + `GetChat` | append, analysis, rename, delete |
| `chats:chat:<id>:head` | first ~50 messages + next cursor | 10m | first page of history | append, analysis, delete |
| `chats:user:<id>:chats` | sidebar summaries, newest-first | 5m | `ListChats` | create, append, analysis, rename, delete |
| `chats:rate_limit:<id>:<scope>:<window>` | burst counter | window end + 2m grace | rate limiter | TTL only |

Rate-limit counters use the same fixed window as the web BFF: an atomic Lua `INCRBY` + `EXPIREAT`, a one-minute window keyed by epoch minute, and a 250 ms call deadline. They fail open — see [Request Flow](request-flow.md).

## The read and write paths

```mermaid
graph TB
    START(["start: an RPC needs data"]) --> KIND{"read or write?"}
    KIND -->|"read: meta, list, first page"| HIT{"Redis hit<br/>and decodes?"}
    HIT -->|"yes"| SERVE["serve from cache<br/>ownership rechecked on meta"] --> END(["end"])
    HIT -->|"no"| WARM["read Mongo, warm the key"] --> END
    KIND -->|"read: cursor page"| MONGO["read Mongo directly<br/>cursors never touch Redis"] --> END
    KIND -->|"write"| FIRST["write Mongo first"] --> DEL["DEL the affected keys<br/>best-effort"] --> END
    DEL -.->|"a DEL fault is logged and absorbed - the TTL bounds staleness"| END
```

Every value is decoded defensively: a JSON value that fails to unmarshal is treated as a miss, re-read from Mongo, and overwritten. That is why there are no version segments in the keys, and why the shared instance is never flushed.

## The cache plane

```mermaid
classDiagram
    class Cache {
        <<interface>>
        +Chat(ctx, id)
        +PutChat(ctx, chat)
        +ChatList(ctx, owner, limit)
        +PutChatList(ctx, owner, list)
        +Head(ctx, id)
        +PutHead(ctx, id, page)
        +InvalidateMeta(ctx, id)
        +InvalidateChat(ctx, id)
        +InvalidateOwner(ctx, owner)
    }
    class Client {
        -client: redis.Client
        +Connect(ctx, endpoint)
        +Ping(ctx)
        +Disconnect(ctx)
    }
    class Entries {
        -client: Client
        +get()
        +put()
        +del()
    }
    class keys {
        <<package>>
        +ChatKey(id)
        +ChatHeadKey(id)
        +OwnerChatsKey(owner)
        +RateLimitKey(owner, scope, window)
    }
    class NullCache
    Cache <|.. Entries
    Cache <|.. NullCache
    Entries o--> Client
    Entries ..> keys : every key carries a TTL
    note for Client "ParseURL, optional password, 5s dial timeout, context deadlines enabled"
    note for NullCache "all reads miss, all writes no-op - installed when Redis is unreachable or absent"
    note for keys "prefix chats: · meta/head 10m · list 5m · rate window + 2m grace"
```

The prefix lives in `keys.go`, never in the Redis client: client-level `keyPrefix` silently misses keys inside Lua `EVAL` scripts, and the limiter is exactly such a script.

## The limiter and the null builds

```mermaid
classDiagram
    class Limiter {
        <<interface>>
        +Consume(ctx, owner, scope, limit) Decision
    }
    class limiter {
        -client: Client
        -timeout: Duration
        +Consume(ctx, owner, scope, limit) Decision
    }
    class Decision {
        +Allowed: bool
        +Count: int
        +Limit: int
        +RetryAfter: Duration
    }
    class NullLimiter {
        +Consume() Decision
    }
    class Setup {
        <<function>>
    }
    Limiter <|.. limiter
    Limiter <|.. NullLimiter
    Setup ..> Limiter : returns the real one or the null
    Setup ..> Cache : same degradation for reads and writes
    note for limiter "unexported implementation behind NewLimiter - atomic Lua INCRBY + EXPIREAT"
    note for limiter "250ms deadline · count ≤ limit allowed · RetryAfter = window end - now"
    note for Decision "the refusal metadata on the wire comes from Count, Limit and RetryAfter"
    note for NullLimiter "always allows - a Redis fault must never surface as resource_exhausted"
    note for Setup "an unreachable Redis at boot returns NullCache + NullLimiter + a no-op disconnect, with a warning"
```

## Failure semantics

- **At boot:** `cache.Setup` pings Redis. An unreachable endpoint installs `NullCache` + `NullLimiter` and the boot continues — Mongo and the RPCs are unaffected.
- **At runtime:** every cache fault is absorbed — a warning log and a metric, never a failed RPC. A limiter fault fails open. The 250 ms deadline keeps a fault from costing the driver's socket timeout.
- **No singleflight:** at chat-UI concurrency a cold head key produces a handful of concurrent Mongo reads, which the compound index serves without ceremony.

## Next Steps

- **[Data Model](data-model.md)** — the documents behind the cached shapes
- **[Request Flow](request-flow.md)** — where the limiter sits in the interceptor chain
- **[Observability](observability.md)** — the cache counter that makes a degrading Redis visible
