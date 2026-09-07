# Request Flows

## CreateChat (sync, mongo write)

```mermaid
sequenceDiagram
    participant K6 as k6 / web
    participant H as Handler.CreateChat
    participant S as ChatService.CreateSession
    participant M as Mongo chats
    K6->>H: CreateChatRequest user_id/title + x-user-id
    H->>H: resolveUserID header-vs-body
    H->>S: CreateSession(userID, title)
    S->>S: trim + MaxTitleLen 200
    S->>M: InsertOne ChatSession uuid
    M-->>S: ok
    S-->>H: session
    H-->>K6: CreateChatResponse chat_id
```

Sync path — no redis involved. Failure in `InsertOne` → `IncDatabaseErrors(create_chat)` + `Internal`, except `DeadlineExceeded/Canceled` passthrough (`usecase/chat_service.go:99`).

## SaveMessage (async ingest via stream)

```mermaid
sequenceDiagram
    participant K6 as k6 / web
    participant H as Handler.SaveMessage
    participant S as ChatService.ProcessMessage
    participant R as Redis stream+cache
    participant W as Worker
    K6->>H: SaveMessageRequest chat_id/user_id/content + x-user-id
    H->>S: ProcessMessage(msg)
    S->>S: trim + MaxContentLen 20000 + role check + future +5m reject
    S->>S: fetchAuthorizedSession ownership
    S->>R: XAdd global:ingest:{p} MaxLen 100000 Approx
    S->>R: SaveToCache Lua warn-only
    S-->>H: ok (message_id, timestamp)
    H-->>K6: SaveMessageResponse
    R->>W: XReadGroup chat_persistence_group
    W->>W: ProcessBatch BulkUpsert + XAck
```

`Publish` partitions by `crc32(chat_id) % partitions` (`redis/stream_repo.go:43`). API returns after `XAdd`, not after mongo — worker persists async. `stream.Publish` failure → `IncStreamErrors(publish)` + `Internal`; cache failure only `Warn` (`usecase/chat_service.go:265`).

## GetHistory (hot/cold cache)

```mermaid
sequenceDiagram
    participant K6 as k6 / web
    participant H as Handler.GetChatHistory
    participant S as ChatService.GetHistory
    participant C as Redis hot ZSET
    participant M as Mongo buckets
    K6->>H: GetChatHistoryRequest chat_id/page/page_size + x-user-id
    H->>S: GetHistory (page clamp 1.., size 20 default/100 max, offset guard 1M)
    alt page==1 and hot hit
        S->>C: ZRevRange chat:{id}:hot
        C-->>S: hotMessages
        S->>M: GetHistory offset/limit
        S->>S: mergeMessages dedup + SortDesc
    else miss / page>1
        S->>M: GetHistory offset/limit
        S->>C: PopulateCache background 5s (page 1 only)
    end
    S-->>H: messages + hasMore len==limit
    H-->>K6: GetChatHistoryResponse
```

Page-1 hot merge returns `merged[:limit]` with `hasMore=true` on trim (`usecase/chat_service.go:313`). `nil` from persistence normalizes to `[]` so `hasMore` stays correct.

## Error branches

| Handler `mapError` (`handler.go:235`) | When |
|---|---|
| `InvalidArgument` | nil body, empty `chat_id/content/title`, `MaxTitleLen/ContentLen/RoleLen`, bad role, `limit` clamped not errored |
| `Unauthenticated` | missing `x-user-id` header and `user_id` field (`resolveUserID`) |
| `PermissionDenied` | header-vs-body `user_id` mismatch, or session `UserID != caller` (`ErrUnauthorized`) |
| `NotFound` | `ErrNotFound` from `GetChat/Update/Delete` |
| `DeadlineExceeded/Canceled` | ctx timeout (`RequestTimeout 10s`) passthrough |
| `Internal` | `IncDatabaseErrors/IncStreamErrors` paths, unexpected failure |
