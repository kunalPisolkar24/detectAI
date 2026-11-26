# Architecture

This document explains how one chat RPC becomes a MongoDB write or a cache-served read. Read [Quick Start](../getting-started/quickstart.md) first if nothing is running yet.

## What this service is

A synchronous chat store: eight ConnectRPCs over Gin, MongoDB as the source of truth, Redis as a read-through overlay, and OTel telemetry pushed to New Relic when configured. It is stateful in the sense that it owns data, but stateless in the sense that one instance holds no state another needs — concurrency comes from more replicas, never from threading inside one.

The wire contract lives in [RPC API](../reference/rpc-api.md); this page is about the components behind it.

## The module map

```
cmd/
├── api/main.go            composition root: flick → config → obs → Mongo → repo → cache → service → serve
└── healthcheck/main.go    container probe against /api/v1/ready
internal/
├── server/                serve until SIGINT/SIGTERM, drain in-flight requests
├── router/                gin engine: probes, grpchealth, reflection, the Connect handler
├── handlers/              the Connect face: interceptors, 8 RPCs, proto↔domain mapping, error codes
├── services/              use cases, validation, cache-aside orchestration
├── repository/            MongoDB data access, the keyset cursor, index creation
├── cache/                 client · keys · store · entries · limiter · lock · coalescer · setup
├── db/                    MongoDB connection + retry
├── config/                typed Config, dev/prod planes, fail-fast
├── models/                shared vocabulary: shapes, enums, sentinels, limits, cursor codec
└── observability/         the OTel facade: the null build or push to New Relic
proto/                     chat_service.proto + generated Go stubs
```

The layering is strict and inward-facing: `handlers` speaks the wire, `services` owns the use cases, `repository`/`cache` own the two stores, and `models` is the vocabulary everybody shares. `services` declares its own narrow `Cache`, `Locker` and `Coalescer` interfaces; the cache packages satisfy them structurally, so the concrete fill strategy can be swapped without changing the use cases. Cold fills run through singleflight and a distributed lock before reaching Mongo, and `not_found` answers are cached briefly so a bad chat id cannot spend the read budget on Mongo. `config` and `observability` serve them all. Nothing inside `services` knows about Connect or MongoDB.

## The components at a glance

Two seams carry the dependency structure: the transport-facing `services.Service` and the app-facing `observability.Telemetry`. Each has one real realization and one null at boot; the handler faces the seam, never a driver type.

```mermaid
classDiagram
    class Service {
        <<interface>>
        +CreateChat(ctx, owner, initialMessage)
        +GetChat(ctx, owner, chatID)
        +ListChats(ctx, owner, limit)
        +RenameChat(ctx, owner, chatID, title)
        +DeleteChat(ctx, owner, chatID)
        +SaveUserMessage(ctx, owner, chatID, id, content, createdAt)
        +SaveAnalysisMessage(ctx, owner, chatID, id, createdAt, analysis)
        +GetChatHistory(ctx, owner, chatID, cursor, limit)
    }
    class ChatService {
        -repo: Repository
        -cache: Cache
        -locker: Locker
        -flights: Coalescer
        -policy: Policy
        -telemetry: Telemetry
    }
    class Repository {
        <<interface>>
        +8 data operations
    }
    class Mongo
    class Cache {
        <<interface>>
        +12 cache operations
    }
    class Entries
    class Limiter {
        <<interface>>
        +Consume(ctx, owner, scope, limit)
    }
    class RedisLimiter
    class Locker {
        <<interface>>
        +Acquire(ctx, key, ttl) token
        +Release(ctx, key, token)
    }
    class Coalescer {
        <<interface>>
        +Do(ctx, key, fn)
    }
    class RedisLocker
    class FlightGroup
    class Database {
        <<interface>>
        +Ping(ctx)
        +Disconnect(ctx)
    }
    class Client
    class Telemetry {
        <<interface>>
        +7 recording methods
    }
    class TelemetryService
    class NullTelemetry
    class NullEntries
    class Null

    Service <|.. ChatService
    Repository <|.. Mongo
    Cache <|.. Entries
    Cache <|.. NullEntries
    Limiter <|.. RedisLimiter
    Limiter <|.. Null
    Locker <|.. RedisLocker
    Coalescer <|.. FlightGroup
    Database <|.. Client
    Telemetry <|.. TelemetryService
    Telemetry <|.. NullTelemetry
    ChatService o--> Repository
    ChatService o--> Cache
    ChatService o--> Locker
    ChatService o--> Coalescer
    ChatService o--> Telemetry
    note for Service "the handler builds against this interface - no proto or driver type crosses it"
    note for Cache "consumer-owned in services - entries and null entries satisfy it structurally"
    note for Locker "consumer-owned in services - singleflight first, then a SETNX lock with a token-guarded release"
    note for Coalescer "consumer-owned in services - FlightGroup collapses same-process duplicate reads"
    note for Telemetry "no OTel import crosses the seam - both realizations satisfy the same seven methods"
    note for RedisLimiter "limiter.Redis behind NewRedis - atomic Lua INCRBY + EXPIREAT"
    note for RedisLocker "SETNX with a random token - a stale holder cannot delete another caller's lock"
    note for NullEntries "an unreachable Redis at boot installs null entries, null limiter and null locker - the RPC still serves"
    note for Database "the readiness probe is its only runtime caller - repository.New takes the driver database directly"
```

## What happens on one RPC

```mermaid
sequenceDiagram
    autonumber
    participant C as caller (BFF)
    participant I as interceptor chain
    participant H as handler
    participant S as ChatService
    participant R as cache + repository
    participant M as MongoDB

    C->>I: CreateChat / GetChat / ...<br/>x-api-key + x-user-id
    I->>I: open span → 8 s budget → verify key → rate limit
    I-->>C: unauthenticated / resource_exhausted on refusal
    I->>H: dispatch with the owner in context
    H->>S: validate, then call the use case
    S->>R: read through the cache overlay
    R-->>S: a hit, or a miss filled from Mongo
    S->>M: writes go to Mongo first
    M-->>S: accepted
    S->>R: invalidate the affected keys
    S-->>H: domain result or typed error
    H-->>C: Connect code + resource
    note over I,S: every refusal is counted - the telemetry interceptor is outermost and settles the verdict on the way out
```

The handler never touches a driver: it extracts the owner, validates, delegates to the service, and maps the typed error onto a code. The full guard sequence is in [Request Flow](request-flow.md).

Questions the map answers, page by page:

- **Who may call, and what can fail?** → [RPC API](../reference/rpc-api.md)
- **What happens inside the chain?** → [Request Flow](request-flow.md)
- **What is cached, and when is it dropped?** → [Cache](cache.md)
- **How is data shaped and paged?** → [Data Model](data-model.md)
- **Where do signals go?** → [Observability](observability.md)

## The boot's components

Composition happens once, top to bottom, before anything serves. The handler arrives through the router, not `main`.

```mermaid
classDiagram
    class main {
        <<package>>
        +main()
    }
    class config {
        <<package>>
        +DeploymentFlick()
        +Load()
    }
    class observability {
        <<package>>
        +Boot(cfg, flick)
        +Wire(t, engine)
    }
    class db {
        <<package>>
        +ConnectWithRetry(ctx, uri, name, interval)
    }
    class repository {
        <<package>>
        +New(ctx, database, telemetry)
    }
    class setup {
        <<package>>
        +New(ctx, endpoint) Plane
    }
    class services {
        <<package>>
        +NewChatService(repo, entries, locker, flights, policy, logger, telemetry)
    }
    class router {
        <<package>>
        +New(db, service, apiKey, limiter, limits, logger, obs)
    }
    class server {
        <<package>>
        +Run(srv, drain)
        -shutdown(srv, drain)
    }
    main --> config : Load names the typed Config
    main --> observability : Boot, null or wired
    main --> db : connect with retry
    main --> repository : New creates the two indexes
    main --> setup : New returns the plane, real or degraded
    main --> services : compose the use cases
    main --> router : New builds the engine
    main --> server : Run with that engine as handler
    note for main "bootBudget 10s · connectRetryInterval 500ms · disconnectBudget 5s · telemetryBudget 15s"
    note for main "fails fast on config, OTel, Mongo connect and index creation - Redis failure only degrades"
    note for repository "an index failure fails the boot - queries must not start against an unindexed collection"
```

## The route face

```mermaid
classDiagram
    class router {
        <<package>>
        +New(database, service, apiKey, limiter, limits, logger, obs)
        +Health()
        +Ready(database)
    }
    class grpchealth {
        <<package>>
        +NewStaticChecker(service)
    }
    class grpcreflect {
        <<package>>
        +NewStaticReflector(name)
    }
    class ChatServiceHandler {
        <<package>>
        +NewChatServiceHandler(service, interceptors)
    }
    router o--> grpchealth : the chats.v1.ChatService check
    router o--> grpcreflect : V1 + V1alpha, unauthenticated
    router o--> ChatServiceHandler : the 8 RPCs on a wildcard route
    note for router "otelgin is wired first so its span brackets gin.Recovery"
    note for ChatServiceHandler "interceptors run telemetry → timeout → auth → rate limit → handler"
    note for router "rpcTimeout 8s sits above the driver's 5s server-selection timeout"
```

## The Mongo connection

```mermaid
classDiagram
    class Database {
        <<interface>>
        +Ping(ctx)
        +Disconnect(ctx)
    }
    class Client {
        -client: mongo.Client
        -database: mongo.Database
        +Connect(ctx, uri, name)
        +ConnectWithRetry(ctx, uri, name, interval)
        +Database()
        +Ping(ctx)
        +Disconnect(ctx)
    }
    Database <|.. Client
    note for Client "dial + server-selection timeout 5s, then Ping - a failed dial fails the boot"
    note for Client "ConnectWithRetry polls every 500ms until the boot's 10s budget, returning the last error"
    note for Database "the readiness probe is its only runtime caller - repository.New takes the driver database directly"
```

## The runtime model: synchronous, deliberately

There is **no worker pool, no executor, and no queue anywhere**. Every RPC is a direct call chain: guard → validate → cache read → Mongo access → invalidate → answer. Concurrency exists outside the process — more replicas — never inside it.

- **H2C + HTTP/1.1 on one port.** Connect negotiates gRPC, gRPC-Web, and Connect over JSON on the same handler. Reflection is the one HTTP/2-only surface (it is a bidirectional stream); an HTTP/1.1 client gets `505`. Both protocols stay enabled — the container healthcheck drives HTTP/1.1 and the load rig drives native gRPC over H2C.
- **The 8 s RPC budget** sits above the driver's 5 s server-selection timeout, so an unreachable Mongo answers `unavailable` before the deadline.
- **Idempotent writes.** A duplicate user-message id returns the stored message; an analysis re-send with the same id replays; a re-delete succeeds. The BFF orchestrates inference and retries, so these writes must be safe to repeat ([Data Model](data-model.md)).

## The boot and shutdown lifecycle

```mermaid
graph LR
    START(["start: cmd/api"]) --> FLICK["resolve ENV_TYPE flick"]
    FLICK --> LOAD["config.Load — the typed Config"]
    LOAD --> FAIL["boot fails fast:<br/>named ConfigError"]
    LOAD --> OBS["boot observability<br/>null or wired"]
    OBS --> MONGO["Mongo connect + retry<br/>within the 10 s budget"]
    MONGO --> IDX["create the two indexes"]
    IDX --> CACHE["setup.New<br/>unreachable Redis degrades to nulls"]
    CACHE --> WIRE["build repo → service → router"]
    WIRE --> SERVE["server.Run on :PORT"]
    SERVE --> SIG["SIGINT / SIGTERM"]
    SIG --> DRAIN["drain in-flight within DRAIN_TIMEOUT"]
    DRAIN --> SHUT["telemetry 15 s, then Mongo + Redis 5 s"]
    SHUT --> END(["end: exit, teardown errors logged"])
    FAIL --> END
```

Nothing is re-resolved per request. On SIGTERM the server stops accepting and drains in-flight requests within `DRAIN_TIMEOUT` (default 10 s); teardown errors are logged, never fatal.

## Canned probes

| Path | Healthy answer |
|------|----------------|
| `GET /api/v1/health` | 200 `{"status":"ok"}` — static |
| `GET /api/v1/ready` | 200 `{"status":"ready"}` — pings MongoDB within 2 s; 503 on failure |

Both are open endpoints. The container runs a separate `healthcheck` binary against `/api/v1/ready` every 30 s with a 3 s client timeout.
