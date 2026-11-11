# Chats — Cache (LLD)

The Redis overlay for the chats service: key namespacing on the shared ElastiCache instance, TTLs, value shapes, and failure semantics. Storage behind the cache lives in [data-model.md](data-model.md); the RPC contract's cache rules (Redis never fails an RPC) live in [../contract.md](../contract.md).

## The shared instance

One ElastiCache cluster per environment (dev/staging/prod) serves every consumer — environment isolation comes from separate instances, never from key prefixes. Cluster-mode disabled; every current operation is single-key. In-transit encryption (`rediss://`) with an AUTH token.

Consumers today and the namespaces they own:

| Service | Prefix | Backing module |
|---------|--------|----------------|
| `web` (Next.js BFF) | `web:` | `apps/web/lib/domain/cache-keys.ts` |
| `chats` | `chats:` | `services/chats/internal/cache/keys.go` (when built) |
| `workers`, `inference` | `worker:`, `inference:` | reserved, no keys yet |

## Namespace convention

`{service}:{purpose-scoped-rest}` — each service keeps its existing key shape behind its own prefix. The rules that make one instance safe for many owners:

1. **The prefix lives in the service's key-builder module, not the client.** ioredis `keyPrefix` is a trap: it does not prefix keys inside Lua `EVAL` scripts, and the web rate limiter is a Lua `INCRBY`+`EXPIREAT`. One keys module per service is the single source of truth.
2. **Every key carries a TTL, no exceptions.** TTL-bounded data plus a shared eviction policy is what makes eviction orderly — a swept key is indistinguishable from an expired one.
3. **No `FLUSHDB`/`FLUSHALL`, ever.** A shared instance cannot be flushed on deploy. Instead every reader decodes defensively: a value that fails to unmarshal is treated as a miss, re-read from the source, and overwritten. This covers value-shape drift across deploys, which is also why there are no `:v1:` version segments.
4. **No logical DBs (`SELECT 0–15`)** — cluster mode does not support them, and prefixes do the same job. **No hash tags** — single-node for now; no multi-key operations exist.
5. **No raw PII in key names** — keys are visible in `redis-cli` and monitoring. Web already hashes emails into its keys; chats uses UUIDs.

## Chats keys

| Key | Value | TTL | Serves | Invalidated by |
|-----|-------|-----|--------|----------------|
| `chats:chat:{id}` | Chat meta: owner, title, updated_at | ~10m | Ownership check + `GetChat` | Append, update-analysis, rename, delete |
| `chats:chat:{id}:head` | Last ~50 messages, newest-first | ~10m | First page of history (`GetChat`, first `GetChatHistory`) | Append, update-analysis, delete |
| `chats:user:{id}:chats` | Sidebar list, newest-first | ~5m | `ListChats` | Create, append, update-analysis, rename, delete |

Values are JSON blobs written from Go structs and read with the defensive-decode rule. Cursor pages (`GetChatHistory` beyond the head) never touch Redis.

### Rate-limit counters

`chats:rate_limit:{userId}:{scope}:{windowId}` — per-minute fixed-window burst counters, one key per user and scope: `create` covers `CreateChat`, `write` covers `SaveUserMessage` + `SaveAnalysisMessage` as one shared budget (an analysis flow does 2–4 writes). Reads are not limited in v1 — defer until load evidence asks for a `read` scope.

Incremented atomically through the same Lua `INCRBY` + `EXPIREAT` script the web limiter runs in production — non-atomic INCR-then-EXPIRE can leak immortal keys. TTL ~2 minutes past the window edge; window ids are epoch minutes.

The numbers are deployment-owned: limits resolve through the config plane (`RATE_LIMIT_*` — SSM parameters in prod, `infra/.env` in dev), never pinned in code or here, with the config factory failing closed to conservative defaults when keys are unset.

Failure rule — **fail open**: Redis down, timeout, or throttle means the check is skipped, counted, and logged. A cache-plane blip must never surface as `RESOURCE_EXHAUSTED`.

## The full key inventory

Everything that can exist on a shared instance at cutover:

| Key | Owner | Purpose |
|-----|-------|---------|
| `web:user:basic:{id}` | web | User profile cache |
| `web:user:basic:email:{emailHash}` | web | Email → profile lookup |
| `web:user:sub:{id}` | web | Subscription cache |
| `web:rate_limit:{userId}:daily:{utcDay}` | web | Usage counters (Lua) |
| `web:analytics:usage:event:{eventId}` | web | Event dedup |
| `web:abuse:{scope}:{identifierHash}:{windowId}` | web | Abuse windows |
| `chats:chat:{id}` | chats | Chat meta |
| `chats:chat:{id}:head` | chats | Head page of messages |
| `chats:user:{id}:chats` | chats | Sidebar list |
| `chats:rate_limit:{userId}:{scope}:{windowId}` | chats | Per-minute burst counters |

## Failure semantics

Cache-aside throughout: a miss, an eviction, or a Redis outage all degrade to a direct read of the source store — Mongo for chats, Postgres for web. Writes go to the source first, then `DEL` the affected keys best-effort; a failed invalidation is logged and absorbed because the TTL bounds staleness. Redis never fails an RPC and never blocks a page.

There is no lock or singleflight on misses — at chat-UI concurrency a cold head cache produces a handful of concurrent Mongo reads, which the compound index serves without ceremony.

## Eviction and the counter caveat

Rate-limit counters — `web:rate_limit` and `chats:rate_limit` — are correctness-bearing (they gate usage), unlike everything else on the instance. Under memory pressure an `allkeys-lru` sweep can drop a mid-window counter and undercount usage. This is accepted: both limiters fail open when Redis is unreachable, so swept counters sit inside the same risk envelope. If usage accounting ever becomes billing-grade, counters move to a dedicated instance — until then the shared instance carries them.

## Config plane

- **chats** — `REDIS_ENDPOINT` (prod: SSM parameter under the service tree; dev: `infra/.env`) and `REDIS_AUTH_TOKEN` (prod: Secrets Manager alongside the service's secrets blob). Bare keys, no comments — repository convention.
- **web** — `REDIS_URL` / `REDIS_PASSWORD` repointed at the ElastiCache endpoint at cutover.
- Infra provisioning (one cluster per environment) is an infra/terraform concern — analogous to the shared SQS queue fabric; a tfctl kind when needed.

## Cutover sequence

All data on both sides is TTL-bounded and disposable, so the migration needs no dual reads or tooling:

1. **Web re-prefixes first** — `cache-keys.ts` gains the `web:` prefix; old unprefixed entries are orphaned and die by TTL (1h–7d). Visible effect: cold user caches → brief read-through on Postgres.
2. **Cutover to ElastiCache at a UTC-day boundary** — the daily rate-limit counters are keyed per UTC day, so switching at midnight loses nothing.
3. **Chats joins with prefixed keys from day one** — there are no old chats keys to migrate.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Instance topology | One shared ElastiCache cluster per environment with service-scoped prefixes | Cheaper to operate than per-service instances; isolation is enforced by the convention, not by spend |
| Prefix placement | In each service's key-builder module | Client-level `keyPrefix` silently misses Lua `EVAL` keys — the web rate limiter's exact pattern |
| Eviction safety | TTL on every key, defensive decode on every read | Makes a shared eviction policy harmless and covers value-shape drift without version segments or flushes |
| Rate limiting | Per-minute fixed-window counters via atomic Lua, fail-open, numbers owned by the config plane | Matches the proven web limiter pattern; chats owns burst protection while business quotas stay at the edge |
| Rate-limit counters on the shared instance | Accepted, with a carve-out trigger | Both limiters already fail open on Redis loss; billing-grade accounting is the trigger to move counters to a dedicated instance |
| Logical DBs and hash tags | Not used | Cluster mode drops DBs; no multi-key ops exist today |
| Environment isolation | By instance, never by prefix | Cross-environment key separation is a network boundary problem, not a naming problem |

## Open questions

1. **Node type, sizing, and AUTH token rotation** — infra decisions; land with the tfctl cache kind.
2. **Upcoming consumers** — whether `workers` or `inference` join soon; their prefixes are reserved above.
3. **Read-scope limits** — deferred until load tests show a scrollback storm pattern; the scope map gains a `read` row then.
