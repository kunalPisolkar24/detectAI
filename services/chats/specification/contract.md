# Connect RPC Design

The wire contract for the chats service: eight Connect RPCs over Gin. Storage decisions live in [data-model.md](references/data-model.md); the cache overlay in [cache.md](references/cache.md). Usage-level docs: [RPC API](../docs/reference/rpc-api.md).

The proto source of truth is [`proto/chat_service.proto`](../proto/chat_service.proto); this spec records the decisions behind it.

## Surface

| RPC | Returns | Purpose |
|-----|---------|---------|
| `CreateChat` | `Chat` | New chat; title derived server-side from the initial message |
| `GetChat` | `Chat` | Meta + head page of messages + `next_cursor` |
| `ListChats` | `ListChatsResponse` | Sidebar summaries, newest-first, server-capped |
| `RenameChat` | `ChatSummary` | Title change; bumps `updated_at` |
| `DeleteChat` | `google.protobuf.Empty` | Chat first, then messages; idempotent |
| `SaveUserMessage` | `Message` | Insert-only, idempotent on id |
| `SaveAnalysisMessage` | `Message` | Upsert keyed on id; the analysis state machine |
| `GetChatHistory` | `GetChatHistoryResponse` | Keyset cursor pages of history |

## The shapes the decisions turn on

```proto
service ChatService {
  rpc CreateChat(CreateChatRequest) returns (Chat);
  rpc GetChat(GetChatRequest) returns (Chat);
  rpc ListChats(ListChatsRequest) returns (ListChatsResponse);
  rpc RenameChat(RenameChatRequest) returns (ChatSummary);
  rpc DeleteChat(DeleteChatRequest) returns (google.protobuf.Empty);
  rpc SaveUserMessage(SaveUserMessageRequest) returns (Message);
  rpc SaveAnalysisMessage(SaveAnalysisMessageRequest) returns (Message);
  rpc GetChatHistory(GetChatHistoryRequest) returns (GetChatHistoryResponse);
}

enum Role { ROLE_UNSPECIFIED = 0; ROLE_USER = 1; ROLE_ASSISTANT = 2; }
enum Model { MODEL_UNSPECIFIED = 0; MODEL_SPARK = 1; MODEL_FLARE = 2; }
enum AnalysisState {
  ANALYSIS_STATE_UNSPECIFIED = 0;
  ANALYSIS_STATE_RUNNING = 1;
  ANALYSIS_STATE_COMPLETED = 2;
  ANALYSIS_STATE_FAILED = 3;
  ANALYSIS_STATE_CANCELLED = 4;
}
enum Label { LABEL_UNSPECIFIED = 0; LABEL_AI = 1; LABEL_HUMAN = 2; }

message Chat {
  string id = 1;
  string title = 2;
  google.protobuf.Timestamp created_at = 3;
  google.protobuf.Timestamp updated_at = 4;
  repeated Message messages = 5;  // head page only, GetChat
  string next_cursor = 6;         // set when the messages page is not the end
}
message ChatSummary {
  string id = 1;
  string title = 2;
  google.protobuf.Timestamp updated_at = 3;
}
message Message {
  string id = 1;
  string chat_id = 2;
  Role role = 3;
  string content = 4;        // empty on analysis messages
  Analysis analysis = 5;     // set on analysis messages
  google.protobuf.Timestamp created_at = 6;
}
message Analysis {
  AnalysisState state = 1;
  Model model = 2;
  string source_message_id = 3;
  string error = 4;          // set on FAILED and CANCELLED
  AnalysisResult result = 5; // set on COMPLETED
}
message AnalysisResult {
  Label label = 1;
  double confidence = 2;
  Scores scores = 3;
  repeated Highlight highlights = 4;
  google.protobuf.Struct raw = 5;
}
```

Request and response messages are in the proto file. The ones with non-obvious semantics:

- `SaveUserMessageRequest` — `message_id` optional (server fallback); `created_at` optional, immutable after insert
- `SaveAnalysisMessageRequest` — `message_id` optional on first save, then the stable identity for every later state write; `error` required for `FAILED`, `analysis` required for `COMPLETED`
- `GetChatHistoryRequest` — `cursor` opaque, empty = first page; `limit` default 50, hard cap 200

## RPC semantics

Every RPC is ownership-checked: the interceptor resolves the caller's identity, and any `chat_id` not owned by that identity answers `NOT_FOUND` — one code for "missing" and "not yours".

Two headers are set by the web BFF: `x-api-key` (constant-time compared against `API_KEY`, required at boot) and `x-user-id` (the owner every RPC speaks for). The api key authenticates the caller, which makes the asserted user trustworthy; the request body carries no `user_id`, so the pre-rebuild spoofing surface is closed. Probes and the `/api/v1` surface stay unauthenticated.

- **CreateChat** — inserts the chat; title = truncation of `initial_message`. Returns the `Chat` with an empty message list.
- **GetChat** — meta + first page of messages (served by `chats:chat:{id}:head`) + `next_cursor`; the cursor chains into `GetChatHistory`.
- **ListChats** — newest-first by `updated_at`; `limit` clamped to default/cap. No cursor in v1 (additive field later).
- **RenameChat** — `$set` title, bump `updated_at`; returns the updated `ChatSummary`.
- **DeleteChat** — chat doc first, messages after, no transaction (orphans are unreachable). Idempotent.
- **SaveUserMessage** — insert-only. Duplicate id = replay: return the existing message, no overwrite.
- **SaveAnalysisMessage** — upsert on `message_id`. An existing id bound to a different chat is `NOT_FOUND`, never silently re-homed. `created_at` set once, immutable. Invalid payloads per state are rejected.
- **GetChatHistory** — see pagination.

The BFF derives its three web views from the one `Analysis`: `analysisStatus` = the subdoc minus `result`, `analysis` = `result`, `analysisLink` = state/model/source triplet. `isStreaming` stays UI-ephemeral — derived from state ≠ COMPLETED, never persisted.

## Pagination

Keyset on `(created_at, _id)`, descending — matching the `{chat_id: 1, created_at: -1, _id: -1}` index. First page: empty cursor. Every later call: pass back `next_cursor` verbatim; empty `next_cursor` = end of history. No `has_more` boolean — two sources of truth for one fact invite drift.

The cursor is opaque base64 over `{chat_id, t, i}` — the chat id is embedded, so a foreign cursor is `INVALID_ARGUMENT`, and the keyset tuple makes concurrent appends harmless. Strict decoding rejects a malformed cursor. The server fetches `limit + 1` to detect the end and shape the next cursor; the client never counts. HMAC-signing is skipped — the only caller is the internal BFF.

| Call (limit 3, messages m1…m10) | Returns |
|---------------------------------|---------|
| `GetChatHistory(chat1)` | m10, m9, m8 + `cursor_C1` |
| `GetChatHistory(chat1, C1)` | m7, m6, m5 + `cursor_C2` |
| `GetChatHistory(chat1, C2)` | m4, m3, m2 + `cursor_C3` |
| `GetChatHistory(chat1, C3)` | m1 + empty cursor |

## Rate limiting

Per-user burst limits on the write surface, enforced by a connect interceptor beside the auth interceptor — one procedure → scope map owns the policy; handlers stay business-only.

- **Scopes** — `create` covers `CreateChat`; `write` covers `SaveUserMessage` and `SaveAnalysisMessage` as one shared budget (an analysis flow does 2–4 writes). Reads are not limited in v1.
- **Business quotas stay at the edge** — the web BFF owns daily usage accounting; chats runs only operational burst protection.
- **Numbers are deployment-owned** — `RATE_LIMIT_CREATE_MAX` / `RATE_LIMIT_WRITE_MAX` resolve through the config plane, failing closed to 10/60 when unset.
- **Fail open, always** — Redis down skips the check; the counter call carries a 250 ms deadline.
- Over-limit answers `RESOURCE_EXHAUSTED` with `retry-after-ms`, `x-ratelimit-limit`, `x-ratelimit-remaining=0` as error metadata.

The interceptor order matters: telemetry is outermost, auth precedes rate limiting, so an unauthenticated call never reaches a counter and a refusal is still counted. Refusals log once per exhausted window; raw owner ids never reach the logs.

| Scope | Procedures | Default budget |
|-------|-----------|----------------|
| `create` | `CreateChat` | 10 per minute |
| `write` | `SaveUserMessage`, `SaveAnalysisMessage` | 60 per minute |

## Errors

| Condition | Connect code |
|-----------|--------------|
| Identity missing or invalid | `UNAUTHENTICATED` |
| Validation: empty/oversize content or title, missing `source_message_id`, bad state/model, malformed or foreign cursor | `INVALID_ARGUMENT` |
| Chat missing or not owned; message id bound to another chat | `NOT_FOUND` |
| Analysis write into a terminal state that is not an identical replay | `FAILED_PRECONDITION` |
| Mongo unavailable | `UNAVAILABLE` |
| Per-user burst limit exceeded | `RESOURCE_EXHAUSTED`, with retry-hint metadata |
| RPC exceeds the 8 s budget | `DEADLINE_EXCEEDED` |
| Anything unexpected | `INTERNAL` |

Redis never fails an RPC: reads degrade to Mongo, a failed invalidation is logged and absorbed (the TTL bounds staleness), and the limiter fails open. Only Mongo faults map to `UNAVAILABLE`.

## Transport and codegen

connect-go mounted on the existing gin engine — the `grpchealth` surface and `/api/v1` probes are unchanged. The server speaks HTTP/1 + unencrypted H2C; connect-go negotiates gRPC, gRPC-Web, and the Connect protocol on one handler. The contract source of truth is `services/chats/proto/chat_service.proto`; `buf generate` emits the Go stubs (`package chatv1`), and a connect-es TypeScript client for the BFF is the sanctioned cross-service artifact.

## Reflection

Server reflection is mounted beside `grpchealth`, at `/grpc.reflection.v1.ServerReflection/` and `/grpc.reflection.v1alpha.ServerReflection/`, serving the `chats.v1.ChatService` descriptor out of the global protobuf registry. The surface is unauthenticated — it discloses schema only, never data; the RPCs keep their own guard. It is HTTP/2-only (an HTTP/1.1 client gets `505`), which is correct: every tool that consumes reflection speaks HTTP/2 by definition.

## Decisions

- **Eight RPCs, mined from the caller** — `apps/web/lib/domain/chat-service.ts` is the spec; everything else is speculative surface. `sendMessage` and `saveAssistantAnalysis` never become RPCs: the BFF orchestrates streaming itself, and the latter was dead code.
- **Identity from metadata, never the payload** — spoofable `user_id` fields were the pre-rebuild contract's worst flaw. An api key for the caller plus a trusted `x-user-id` header closes it without a second credential system.
- **Resources instead of `bool success`** — failures are codes; success responses carry state the caller would otherwise re-fetch.
- **Keyset pagination with a chat-bound cursor** — offset pagination skips/duplicates under concurrent appends; the cursor chain composes `GetChat` → `GetChatHistory` across one index.
- **Two message verbs instead of one blob** — user messages are insert-only; analysis messages are upserts with a state machine. The payload split is real: analysis messages carry no content. The pre-rebuild `metadata` string map (which smuggled `analysisLink`) is gone.
- **Idempotent writes on client-supplied ids** — duplicate user-message save = replay (implemented: no overwrite), analysis saves re-send the same id across the state machine, delete is idempotent. Terminal-state enforcement is implemented as `FAILED_PRECONDITION` for a non-identical write.
- **No streaming RPCs** — chats is a synchronous store; the BFF streams inference directly.
- **Reflection on, unauthenticated, always mounted** — a debugging surface that needs a credential is one nobody reaches. A config gate buys nothing: the schema is public to anyone who can reach the port, and the cost is that the tool must carry a key.
