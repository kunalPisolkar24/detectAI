# Data Model

MongoDB is the source of truth: two collections, two indexes, and an analysis state machine embedded in the message document. Redis holds disposable read shapes — see [Cache](cache.md).

## Entities

```mermaid
erDiagram
    CHAT ||--o{ MESSAGE : "contains"
    MESSAGE ||--o| ANALYSIS : "embeds on analysis messages"
    MESSAGE ||--o| MESSAGE : "analyzes via source_message_id"

    CHAT {
        string _id PK "server-generated UUID"
        string user_id "from the auth interceptor, never from the request"
        string title "bounded at the service layer"
        datetime created_at "UTC"
        datetime updated_at "sidebar order key"
    }
    MESSAGE {
        string _id PK "client UUID or server fallback; duplicate is a replay"
        string chat_id FK "ownership resolves through the chat"
        string role "user or assistant"
        string content "empty on analysis messages"
        datetime created_at "UTC; keyset key with _id"
    }
    ANALYSIS {
        string state "running to completed, failed or cancelled"
        string model "spark or flare"
        string source_message_id FK "the user message under analysis"
        string error "set on failed and cancelled"
        object result "set on completed"
    }
```

## Collections and indexes

| Collection | Fields | Index | Serves |
|------------|--------|-------|--------|
| `chats` | `_id`, `user_id`, `title`, `created_at`, `updated_at` | `{user_id: 1, updated_at: -1}` | sidebar list, newest-first |
| `messages` | `_id`, `chat_id`, `role`, `content?`, `analysis?`, `created_at` | `{chat_id: 1, created_at: -1, _id: -1}` | keyset history pages |

Both indexes are created at boot by `repository.New`; an index failure fails the boot. Timestamps are stored UTC, truncated to milliseconds. The embedded `analysis` subdoc carries `state`, `model`, `source_message_id`, `error?`, and `result?`; `result` holds `label`, `confidence`, `scores{ai, human}`, `highlights[]`, and `raw`.

## The shared vocabulary

```mermaid
classDiagram
    class Chat {
        +ID: string
        +UserID: string
        +Title: string
        +CreatedAt: time.Time
        +UpdatedAt: time.Time
    }
    class ChatSummary {
        +ID: string
        +Title: string
        +UpdatedAt: time.Time
    }
    class Message {
        +ID: string
        +ChatID: string
        +Role: Role
        +Content: string
        +Analysis: Analysis
        +CreatedAt: time.Time
    }
    class Analysis {
        +State: AnalysisState
        +Model: Model
        +SourceMessageID: string
        +Error: string
        +Result: AnalysisResult
    }
    class AnalysisResult {
        +Label: Label
        +Confidence: float64
        +Scores: Scores
        +Highlights: list
        +Raw: struct
    }
    class Page {
        +Messages: list
        +NextCursor: string
    }
    class CursorKey {
        +ChatID: string
        +T: time.Time
        +ID: string
    }
    class EncodeCursor {
        <<function>>
    }
    class DecodeCursor {
        <<function>>
    }
    Chat o--> Message : one chat, many messages
    Message o--> Analysis : embedded
    Analysis o--> AnalysisResult : completed only
    EncodeCursor ..> CursorKey
    DecodeCursor ..> CursorKey
    note for CursorKey "base64.RawURLEncoding over JSON - strict decode, rejects incomplete keys"
    note for Message "IDs are client-supplied with a server fallback - a duplicate insert is a replay, not an error"
    note for Page "the head page is cached; NextCursor chains straight into GetChatHistory"
```

## Keyset pagination

History is keyset-paged on `(created_at, _id)`, descending — matching the messages index. Empty cursor means first page; every later call passes `next_cursor` back verbatim; an empty `next_cursor` means end of history.

The cursor is opaque base64 over `{chat_id, t, i}`. The chat id is embedded, so a cursor from another chat is `invalid_argument`; strict decoding rejects a malformed one the same way. The server fetches `limit + 1` to decide the next cursor — the client never counts.

| Call (limit 3, messages m1…m10) | Returns |
|---------------------------------|---------|
| `GetChatHistory(chat1)` | m10, m9, m8 + `cursor_C1` |
| `GetChatHistory(chat1, C1)` | m7, m6, m5 + `cursor_C2` |
| `GetChatHistory(chat1, C2)` | m4, m3, m2 + `cursor_C3` |
| `GetChatHistory(chat1, C3)` | m1 + empty cursor |

Concurrent appends are harmless: new messages appear above the first page, and the keyset tuple makes an in-flight page neither skip nor duplicate.

## The analysis state machine

`running` is the only non-terminal state; the other three are terminal. A terminal state accepts only an identical replay of itself — any different write is `failed_precondition`.

```mermaid
graph TB
    START(["start: SaveAnalysisMessage"]) --> OWN{"chat owned by caller?"}
    OWN -->|"no"| NF["not_found"] --> END(["end"])
    OWN -->|"yes"| TERM{"existing message<br/>in a terminal state?"}
    TERM -->|"yes"| SAME{"identical replay?"}
    SAME -->|"yes"| OLD["return the stored message"] --> END
    SAME -->|"no"| CONF["failed_precondition"] --> END
    TERM -->|"no"| WRITE["insert or $set the analysis<br/>created_at set once"] --> CHECK{"state payload valid?"}
    CHECK -->|"no"| INV["invalid_argument"] --> END
    CHECK -->|"yes"| STORED["running → completed / failed / cancelled"] --> END
```

`SaveAnalysisMessage` retries the read–insert race up to three times, sets `created_at` once, and re-homes nothing: an id bound to a different chat is `not_found`.

## Idempotency at a glance

| Write | Repeat behavior |
|-------|-----------------|
| `CreateChat` | new UUID each call; no client id |
| `SaveUserMessage` | duplicate id returns the stored message, no overwrite |
| `SaveAnalysisMessage` | same id replays / advances the state machine; a different write into a terminal state is refused |
| `DeleteChat` | chat document first, then messages; a re-delete succeeds, another owner's chat is `not_found` |

Delete has no transaction. The worst case is orphaned messages that no query can reach, which avoids requiring replica-set transactions in local compose.

## The data access

```mermaid
classDiagram
    class Repository {
        <<interface>>
        +CreateChat(ctx, chat)
        +Chat(ctx, owner, id)
        +Chats(ctx, owner, limit)
        +RenameChat(ctx, owner, id, title)
        +DeleteChat(ctx, owner, id)
        +SaveUserMessage(ctx, msg)
        +SaveAnalysisMessage(ctx, msg)
        +ChatHistory(ctx, owner, id, key, limit)
    }
    class Mongo {
        -chats: Collection
        -messages: Collection
        -telemetry: Telemetry
        +New(ctx, database, telemetry)
    }
    class keysetFilter {
        <<function>>
    }
    class ensureIndexes {
        <<function>>
    }
    class ErrNotFound
    class ErrInvalidCursor
    class ErrConflict
    class ErrUnavailable
    Repository <|.. Mongo
    Mongo ..> keysetFilter
    Mongo ..> ensureIndexes : creates both indexes at boot
    Mongo ..> ErrNotFound
    Mongo ..> ErrInvalidCursor
    Mongo ..> ErrConflict
    Mongo ..> ErrUnavailable
    note for Mongo "every method threads ownerID - missing and not-yours collapse into ErrNotFound"
    note for keysetFilter "created_at < t OR (created_at = t AND _id < id) - a foreign cursor is ErrInvalidCursor"
    note for ErrConflict "a non-identical write into a terminal analysis state"
    note for ErrUnavailable "driver network and timeout errors map here - the only 503-class fault"
```

## Next Steps

- **[Cache](cache.md)** — the disposable read shapes over these documents
- **[Request Flow](request-flow.md)** — where validation and ownership checks happen
- **[RPC API](../reference/rpc-api.md)** — the types these documents map onto
