# Caching

Hot cache is redis ZSET `chat:{chat_id}:hot` (score = `CreatedAt` unix + nanos), capped at `MaxCacheSize 100`, TTL `CACHE_TTL 24h` (`redis/cache_repo.go:54`).

## Write path

```mermaid
graph TB
    API[ProcessMessage] --> Lua[Eval saveToCacheScript]
    Lua --> Dedup{ZRANGE decode id==new?}
    Dedup -->|yes| Rem[ZREM old]
    Dedup -->|no| Keep
    Rem --> Add[ZADD score member]
    Keep --> Add
    Add --> Trim[ZREMRANGEBYRANK 0,-101]
    Trim --> Exp[EXPIRE ttl]
    Lua -->|Eval err| Fall[saveToCacheFallback pipeline]
```

* Lua is atomic dedup-by-`id` + insert + trim + expire; fallback does same via `ZRANGE` + pipeline (`ZRem/ZAdd/ZRemRangeByRank/Expire`).
* `SaveToCache` no-ops on `nil/empty chat_id/id`; marshal failure returns error (caller only `Warn`, never fails RPC).
* `DeleteCache` (`Del`) on `DeleteSession`; failure only `Warn`.

## Read path

```mermaid
graph TB
    Get[GetHistory page==1] --> ZRev[ZRevRange 0,-1]
    ZRev -->|empty/nil| Miss[IncCacheMiss → DB + bg Populate]
    ZRev -->|hit| Hit[IncCacheHit]
    Hit --> DB2[DB offset/limit]
    DB2 --> Merge[mergeMessages dedup + SortDesc]
    Merge -->|len>limit| Trim2[merged:limit hasMore=true]
    Merge -->|else| Ret[merged hasMore=len==limit]
```

* `GetRecentMessages` skips undecodable/empty-`id` members; `nil` on empty so caller falls back to DB.
* `PopulateCache` dedups input by `id`, diffs against existing (`ZRange` decode), pipeline `ZRem` stale + `ZAdd` + trim + `Expire`, runs in background `5s` (`CachePopulateTimeout`) only on page-1 miss.
* Pages `>1` never touch cache (cold mongo directly).

## Class view

```mermaid
classDiagram
    class CacheRepository {
        -ttl: Duration
        +SaveToCache(msg)
        +GetRecentMessages(chatID)
        +PopulateCache(chatID, msgs)
        +DeleteCache(chatID)
    }
    class ChatService {
        +ProcessMessage()
        +GetHistory()
    }
    ChatService --> CacheRepository
```

Tuning: raise `CACHE_TTL` for read-heavy chats (memory), lower `MaxCacheSize` if ZSET decode dominates; misses are safe (DB fallback + bg fill).
