# Chats — Cache (LLD)

The Redis overlay for the chats service: key namespacing on the shared ElastiCache instance, TTLs, value shapes, and failure semantics. Storage behind the cache lives in [data-model.md](data-model.md); the RPC contract's cache rules live in [contract.md](../contract.md). Usage-level docs: [Cache](../../docs/concepts/cache.md).

## The shared instance

One ElastiCache Serverless cache per environment (dev/staging/prod) serves every consumer — environment isolation comes from separate caches, never from key prefixes. Every current operation is single-key. Serverless enforces TLS in transit (`rediss://`); there is no AUTH token — network access is governed by the cache's security group.

Consumers today and the namespaces they own:

| Service | Prefix | Backing module |
|---------|--------|----------------|
| `web` (Next.js BFF) | `web:` | `apps/web/lib/domain/cache-keys.ts` |
| `chats` | `chats:` | `services/chats/internal/cache/keys.go` |
| `workers`, `inference` | `worker:`, `inference:` | reserved, no keys yet |

## Namespace convention

`{service}:{purpose-scoped-rest}` — each service keeps its existing key shape behind its own prefix. The rules that make one instance safe for many owners:

1. **The prefix lives in the service's key-builder module, not the client.** ioredis `keyPrefix` is a trap: it does not prefix keys inside Lua `EVAL` scripts, and the web rate limiter is a Lua `INCRBY`+`EXPIREAT`. One keys module per service is the single source of truth.
2. **Every key carries a TTL, no exceptions.** TTL-bounded data plus a shared eviction policy is what makes eviction orderly — a swept key is indistinguishable from an expired one.
3. **No `FLUSHDB`/`FLUSHALL`, ever.** A shared instance cannot be flushed on deploy. Instead every reader decodes defensively: a value that fails to unmarshal is treated as a miss, re-read from the source, and overwritten. This covers value-shape drift across deploys, which is also why there are no `:v1:` version segments.
4. **No logical DBs (`SELECT 0–15`)** — serverless does not support them, and prefixes do the same job. **No hash tags** — no multi-key operations exist.
5. **No raw PII in key names** — keys are visible in `redis-cli` and monitoring. Web hashes emails; chats uses UUIDs.

## Chats keys

| Key | Value | TTL | Serves | Invalidated by |
|-----|-------|-----|--------|----------------|
| `chats:chat:{id}` | Chat meta: owner, title, updated_at | 10m | Ownership check + `GetChat` | Append, update-analysis, rename, delete |
| `chats:chat:{id}:head` | Last ~50 messages, newest-first | 10m | First page of history (`GetChat`, first `GetChatHistory`) | Append, update-analysis, delete |
| `chats:user:{id}:chats` | Sidebar list, newest-first | 5m | `ListChats` | Create, append, update-analysis, rename, delete |

Values are JSON blobs written from Go structs and read with the defensive-decode rule. Cursor pages (`GetChatHistory` beyond the head) never touch Redis.

### Rate-limit counters

`chats:rate_limit:{userId}:{scope}:{windowId}` — per-minute fixed-window burst counters, one key per user and scope: `create` covers `CreateChat`, `write` covers `SaveUserMessage` + `SaveAnalysisMessage` as one shared budget (an analysis flow does 2–4 writes). Reads are not limited in v1.

Incremented atomically through the same Lua `INCRBY` + `EXPIREAT` script the web limiter runs in production — non-atomic INCR-then-EXPIRE can leak immortal keys. The window is one minute, the window id is the epoch minute it opens at, and the TTL runs to the window edge plus a two-minute grace. The counter call carries a 250 ms deadline.

The numbers are deployment-owned: `RATE_LIMIT_CREATE_MAX` and `RATE_LIMIT_WRITE_MAX` resolve through the config plane, with the config factory failing closed to conservative defaults (10 creates, 60 writes per minute) when keys are unset. A malformed or non-positive number fails the boot.

Failure rule — **fail open**: Redis down, timeout, or throttle means the check is skipped, counted, and logged. A cache-plane blip must never surface as `RESOURCE_EXHAUSTED`.

## Failure semantics

Cache-aside throughout: a miss, an eviction, or a Redis outage all degrade to a direct read of the source store — Mongo for chats, Postgres for web. Writes go to the source first, then `DEL` the affected keys best-effort; a failed invalidation is logged and absorbed because the TTL bounds staleness. Redis never fails an RPC and never blocks a page.

There is no lock or singleflight on misses — at chat-UI concurrency a cold head cache produces a handful of concurrent Mongo reads, which the compound index serves without ceremony. `cache.Setup` pings Redis at boot; an unreachable endpoint installs `NullCache` + `NullLimiter` and the boot continues.

## Eviction and the counter caveat

Rate-limit counters — `web:rate_limit` and `chats:rate_limit` — are correctness-bearing (they gate usage), unlike everything else on the instance. Under memory pressure an `allkeys-lru` sweep can drop a mid-window counter and undercount usage. This is accepted: both limiters fail open when Redis is unreachable, so swept counters sit inside the same risk envelope. If usage accounting ever becomes billing-grade, counters move to a dedicated instance.

## Config plane

- **chats** — `REDIS_ENDPOINT` (prod: SSM under the service tree; dev: `infra/.env`), carrying the tokenless `rediss://` endpoint of the serverless cache.
- **web** — `REDIS_URL` / `REDIS_PASSWORD` repointed at the ElastiCache endpoint at cutover.
- Infra provisioning (one serverless cache per environment) is an infra/terraform concern — a tfctl kind when needed.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Instance topology | One shared ElastiCache Serverless cache per environment with service-scoped prefixes | Cheaper to operate than per-service caches; isolation is enforced by the convention, not by spend |
| Prefix placement | In each service's key-builder module | Client-level `keyPrefix` silently misses Lua `EVAL` keys — the web rate limiter's exact pattern |
| Eviction safety | TTL on every key, defensive decode on every read | Makes a shared eviction policy harmless and covers value-shape drift without version segments or flushes |
| Rate limiting | Per-minute fixed-window counters via atomic Lua, fail-open, numbers owned by the config plane | Matches the proven web limiter pattern; chats owns burst protection while business quotas stay at the edge |
| Counters on the shared instance | Accepted, with a carve-out trigger | Both limiters already fail open on Redis loss; billing-grade accounting is the trigger to move counters to a dedicated instance |
| Logical DBs and hash tags | Not used | Cluster mode drops DBs; no multi-key ops exist today |
| Environment isolation | By instance, never by prefix | Cross-environment key separation is a network boundary problem, not a naming problem |
| Cutover | Web re-prefixes first; chats joins with prefixed keys from day one | All data is TTL-bounded and disposable; there are no old chats keys to migrate |
| Read-scope limits | Deferred until load tests show a scrollback storm | The scope map gains a `read` row then, not on speculation |
