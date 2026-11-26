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
        +Raw()
        +Ping(ctx)
        +Disconnect(ctx)
    }
    class Store {
        <<interface>>
        +Get(ctx, key, into)
        +Set(ctx, key, value, ttl)
        +Delete(ctx, keys...)
    }
    class Entries {
        -store: Store
        +9 cache operations
    }
    class keys {
        <<package>>
        +ChatKey(id)
        +ChatHeadKey(id)
        +OwnerChatsKey(owner)
        +RateLimitKey(owner, scope, window)
    }
    class NullEntries
    Cache <|.. Entries
    Cache <|.. NullEntries
    Entries o--> Store
    Entries ..> keys : every key carries a TTL
    note for Client "ParseURL, 5s dial timeout, context deadlines enabled - Raw hands the driver to the Lua limiter"
    note for Store "JSON get/set/delete - a value that fails to decode is a miss"
    note for NullEntries "all reads miss, all writes no-op - installed when Redis is unreachable or absent"
    note for keys "prefix chats: · meta/head 10m · list 5m · rate window + 2m grace"
```

The prefix lives in `internal/cache/keys`, never in the Redis client: client-level `keyPrefix` silently misses keys inside Lua `EVAL` scripts, and the limiter is exactly such a script. The cache surface is split by responsibility the way the users service splits its cache — `client`, `keys`, `store`, `entries`, `limiter` and `setup` — so a singleflight or locking layer can be added as another package without rewriting the callers.

## The limiter and the null builds

```mermaid
classDiagram
    class Limiter {
        <<interface>>
        +Consume(ctx, owner, scope, limit) Decision
    }
    class Redis {
        -client: redis.Client
        -timeout: Duration
        +Consume(ctx, owner, scope, limit) Decision
    }
    class Decision {
        +Allowed: bool
        +Count: int
        +Limit: int
        +RetryAfter: Duration
    }
    class Null {
        +Consume() Decision
    }
    class Plane {
        +Entries: Cache
        +Limiter: Limiter
    }
    class setup {
        <<package>>
        +New(ctx, endpoint) Plane
    }
    Limiter <|.. Redis
    Limiter <|.. Null
    setup ..> Plane : returns the real plane or both nulls
    note for Redis "limiter.Redis behind NewRedis - atomic Lua INCRBY + EXPIREAT"
    note for Redis "250ms deadline · count ≤ limit allowed · RetryAfter = window end - now"
    note for Decision "the refusal metadata on the wire comes from Count, Limit and RetryAfter"
    note for Null "always allows - a Redis fault must never surface as resource_exhausted"
    note for setup "an unreachable Redis at boot returns null entries + null limiter + a no-op disconnect, with a warning"
```

## Failure semantics

- **At boot:** `setup.New` pings Redis. An unreachable endpoint installs null entries and a null limiter and the boot continues — Mongo and the RPCs are unaffected.
- **At runtime:** every cache fault is absorbed — a warning log and a metric, never a failed RPC. A limiter fault fails open. The 250 ms deadline keeps a fault from costing the driver's socket timeout.
- **No singleflight:** at chat-UI concurrency a cold head key produces a handful of concurrent Mongo reads, which the compound index serves without ceremony.

## Next Steps

- **[Data Model](data-model.md)** — the documents behind the cached shapes
- **[Request Flow](request-flow.md)** — where the limiter sits in the interceptor chain
- **[Observability](observability.md)** — the cache counter that makes a degrading Redis visible
