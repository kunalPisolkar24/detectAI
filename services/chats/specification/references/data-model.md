# Chats — Data Model (LLD)

MongoDB documents, indexes, and the Redis overlay for the chats service. The consumer shape is fixed by the web BFF's domain types (`apps/web/lib/domain/chat.ts`); this doc maps those types onto storage. Usage-level docs: [Data Model](../../docs/concepts/data-model.md).

The async worker path is dropped — the analysis flow is synchronous CRUD (BFF → chats RPC), so there is no queue payload, no bulk upsert, and no consumer here.

## Entities

Two collections:

- **`chats`** — one document per chat session. Owns identity (`user_id`), display (`title`), and ordering (`updated_at`).
- **`messages`** — one flat document per message. Assistant analysis messages embed their analysis payload inline; the analysis state machine lives on the embedded document.

```mermaid
erDiagram
    CHAT ||--o{ MESSAGE : "contains"
    MESSAGE ||--o| ANALYSIS : "embeds on assistant analysis messages"
    MESSAGE ||--o| MESSAGE : "analyzes via source_message_id"

    CHAT {
        string _id PK "server-generated UUID"
        string user_id "session-authoritative, never from the request"
        string title "bounded at the service layer"
        datetime created_at "UTC"
        datetime updated_at "sidebar order key; bumps on append, analysis, rename"
    }
    MESSAGE {
        string _id PK "BFF-supplied UUID, server fallback; duplicate insert = replay"
        string chat_id FK "ownership resolves through the chat doc"
        string role "user or assistant"
        string content "bounded at the service layer"
        datetime created_at "UTC; keyset cursor key with _id"
    }
    ANALYSIS {
        string state "running, completed, failed, cancelled"
        string model "spark or flare"
        string source_message_id FK "the user message under analysis"
        string error "populated on failed and cancelled"
        object result "completed only: label, confidence, scores, highlights, raw"
    }
```

## Collections

### `chats`

| Field | Type | Notes |
|-------|------|-------|
| `_id` | string | Server-generated UUID |
| `user_id` | string | From the auth interceptor; never accepted from the request |
| `title` | string | Bounded; validated at the service layer |
| `created_at` | datetime | UTC |
| `updated_at` | datetime | Sidebar order key — bumps on message append, analysis state change, rename |

### `messages`

| Field | Type | Notes |
|-------|------|-------|
| `_id` | string | BFF-supplied UUID, server-generated fallback. Duplicate-key insert = idempotent replay |
| `chat_id` | string | FK to `chats._id`; ownership resolves through the chat doc |
| `role` | string | `user` or `assistant` |
| `content` | string | Bounded; validated at the service layer |
| `created_at` | datetime | UTC; keyset cursor key together with `_id` |
| `analysis` | object | Optional, assistant analysis messages only — see below |

Embedded `analysis` object:

| Field | Type | Notes |
|-------|------|-------|
| `state` | string | `running` → `completed` / `failed` / `cancelled` |
| `model` | string | `spark` or `flare` |
| `source_message_id` | string | The user message this analysis belongs to |
| `error` | string | Optional, set on `failed` and `cancelled` |
| `result` | object | Set once `completed`: `label`, `confidence`, `scores{ai, human}`, `highlights[]`, `raw` |

## Indexes

| Collection | Index | Serves |
|------------|-------|--------|
| `chats` | `{ user_id: 1, updated_at: -1 }` | Sidebar list — newest-first chats for one user |
| `messages` | `{ chat_id: 1, created_at: -1, _id: -1 }` | Chat history — keyset pagination, newest-first, `_id` as timestamp tiebreaker |

Two indexes beyond the defaults is the whole story. Both are created at boot by `repository.New`; an index failure fails the boot. Cursor = `(created_at, _id)` of the last message on the page.

## Redis overlay

Cache-aside, invalidate-on-write, TTL safety net. Mongo is the source of truth; staleness is tolerated by a chat UI. Keys carry the `chats:` service prefix on a shared instance; the key inventory, TTLs, and failure semantics live in [cache.md](cache.md), with a beginner-facing version in [Cache](../../docs/concepts/cache.md).

Every mutation fans out to Mongo then `DEL`s the affected keys — an append touches all three. Cursor pages never touch Redis; only the common first page does.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Message storage | Flat document per message | The pre-rebuild bucket design had append races, in-memory pagination, and a fetch cap that made deep history unreachable; an index range scan is simpler and fast enough at this volume |
| Analysis payload | Embedded in the message doc | 1:1 with its message; one query serves history; state transitions are a `$set` on the subdoc |
| `user_id` on messages | Dropped | Ownership flows `chat_id` → chat; the session is authoritative per the web interface |
| Message `_id` | BFF-supplied UUID, server fallback | Idempotent appends — the BFF orchestrates inference and retries; a duplicate-key insert is a replay, not an error |
| Delete consistency | Chat doc first, then messages, no transaction | Worst case is orphaned unreachable messages; avoids requiring replica-set transactions in compose |
| Pagination | Keyset on `(created_at, _id)` | History is append-only; offset pagination was the pre-rebuild bug |
| Cache strategy | Cache-aside, invalidate-on-write, TTL safety net | At human typing speed DEL-on-write is cheap; no ZSET or write-through cleverness |
| Async path | Worker and SQS consumer dropped | Simple CRUD; analysis results flow synchronously BFF → chats RPC |
| Terminal-state writes | Reject non-identical writes with `FAILED_PRECONDITION` | The BFF's cancel-after-failure path can double-write the same terminal state; the identical-replay rule admits that but not a different payload |
