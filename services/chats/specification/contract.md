# Connect RPC Design

The wire contract for the chats service: eight Connect RPCs over the existing gin surface. Storage decisions live in [data-model.md](references/data-model.md); module layout and testing follow in `design.md`. The consumer is the web BFF (`apps/web/lib/domain/chat-service.ts`); this contract mirrors only what that caller actually uses.

## What the contract drops from the pre-rebuild surface, deliberately

1. **`user_id` leaves every request** — identity resolves from auth metadata on every call; the session is authoritative. The pre-rebuild proto carried `user_id` fields the client could spoof.
2. **`bool success` responses are gone** (`RenameChatResponse`, `DeleteChatResponse`) — failures are Connect codes, successes return the updated resource.
3. **Offset pagination is gone** (`page`/`page_size`) — keyset cursors only (below).
4. **One `SaveMessage` blob is split in two** — user messages and analysis messages have different payloads and lifecycles; the pre-rebuild `metadata` string map (which smuggled `analysisLink`) is gone with it.
5. **Two interface methods never become RPCs** — `sendMessage` (orchestration lives in the BFF, which streams inference itself) and `saveAssistantAnalysis` (dead code even in the mock).
6. **No streaming RPCs** — analysis streams BFF ↔ inference directly; chats is a synchronous CRUD store, the async worker path is retired.

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

## Types

```proto
syntax = "proto3";

package chats.v1;

import "google/protobuf/empty.proto";
import "google/protobuf/struct.proto";
import "google/protobuf/timestamp.proto";

option go_package = "github.com/kunalPisolkar24/detectAI/services/chats/proto;chatv1";

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

enum Role {
  ROLE_UNSPECIFIED = 0;
  ROLE_USER = 1;
  ROLE_ASSISTANT = 2;
}

enum Model {
  MODEL_UNSPECIFIED = 0;
  MODEL_SPARK = 1;
  MODEL_FLARE = 2;
}

enum AnalysisState {
  ANALYSIS_STATE_UNSPECIFIED = 0;
  ANALYSIS_STATE_RUNNING = 1;
  ANALYSIS_STATE_COMPLETED = 2;
  ANALYSIS_STATE_FAILED = 3;
  ANALYSIS_STATE_CANCELLED = 4;
}

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

message ListChatsResponse {
  repeated ChatSummary chats = 1;
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
  google.protobuf.Struct raw = 5;  // capped at the service layer
}

message Scores {
  double ai = 1;
  double human = 2;
}

message Highlight {
  int32 char_start = 1;
  int32 char_end = 2;
  double ai_confidence = 3;
  Label label = 4;
}

enum Label {
  LABEL_UNSPECIFIED = 0;
  LABEL_AI = 1;
  LABEL_HUMAN = 2;
}
```

## Requests

```proto
message CreateChatRequest {
  string initial_message = 1;
}

message GetChatRequest {
  string chat_id = 1;
}

message ListChatsRequest {
  int32 limit = 1;  // optional; server default and hard cap
}

message RenameChatRequest {
  string chat_id = 1;
  string title = 2;
}

message DeleteChatRequest {
  string chat_id = 1;
}

message SaveUserMessageRequest {
  string chat_id = 1;
  string content = 2;
  string message_id = 3;                     // optional; server-generated fallback
  google.protobuf.Timestamp created_at = 4;  // optional; immutable after insert
}

message SaveAnalysisMessageRequest {
  string chat_id = 1;
  string message_id = 2;                     // optional on first save; the stable identity for every later state write
  google.protobuf.Timestamp created_at = 3;  // optional; immutable after insert
  AnalysisState state = 4;
  Model model = 5;
  string source_message_id = 6;
  string error = 7;                          // required for FAILED
  AnalysisResult analysis = 8;               // required for COMPLETED
}

message GetChatHistoryRequest {
  string chat_id = 1;
  string cursor = 2;  // opaque; empty = first page
  int32 limit = 3;    // optional; default 50, hard cap 200
}

message GetChatHistoryResponse {
  repeated Message messages = 1;  // newest-first
  string next_cursor = 2;         // empty = end of history
}
```

## RPC semantics

Every RPC is ownership-checked: the interceptor resolves the caller's identity, and any `chat_id` not owned by that identity answers `NOT_FOUND` — one code for "missing" and "not yours".

### Authentication

Two headers, both set by the web BFF:

- **`x-api-key`** — the service credential, compared in constant time against the `API_KEY` the config plane resolves. Missing or wrong answers `UNAUTHENTICATED` with the same message either way; the attempt is never echoed. The key is required at boot — an unset key would authenticate everyone.
- **`x-user-id`** — the owner every RPC speaks for. Missing answers `UNAUTHENTICATED`.

The api key authenticates the caller, which is what makes the asserted `x-user-id` trustworthy: only a holder of the key can name a user. The request body carries no `user_id` — the header is the only channel, so the pre-rebuild spoofing surface is closed. The health surface and the `/api/v1` probes stay unauthenticated.

- **CreateChat** — inserts the chat; title = truncation of `initial_message` (the web never passes a title on create). Returns the `Chat` with an empty message list.
- **GetChat** — meta + first page of messages (the `chats:chat:{id}:head` cache serves this) + `next_cursor`; the cursor chains straight into `GetChatHistory` for scrollback.
- **ListChats** — newest-first by `updated_at`; `limit` clamped to the server default/cap. No cursor in v1 (additive field later, non-breaking).
- **RenameChat** — `$set` title, bump `updated_at`; returns the updated `ChatSummary`.
- **DeleteChat** — chat doc first, messages after, no transaction (orphaned messages are unreachable). Idempotent: deleting an already-deleted chat returns success; another user's chat is `NOT_FOUND`.
- **SaveUserMessage** — insert-only. Duplicate id = replay: return the existing message, **no overwrite** — the BFF never intends to mutate user content. `content` bounds validated.
- **SaveAnalysisMessage** — upsert keyed on `message_id`. Insert when absent; otherwise `$set` the embedded analysis subdoc. `created_at` set once, immutable. An existing id bound to a different `chat_id` is `NOT_FOUND`, never silently re-homed. Invalid payloads per state: `COMPLETED` requires `analysis`, `FAILED` requires `error`.
- **GetChatHistory** — see pagination.

The BFF derives its three web views from the one `Analysis`: `analysisStatus` = the subdoc minus `result`, `analysis` = `result`, `analysisLink` = state/model/source triplet. `isStreaming` stays UI-ephemeral — derived from state ≠ COMPLETED, never persisted.

## Pagination

Keyset on `(created_at, _id)`, descending — matching the `{chat_id: 1, created_at: -1, _id: -1}` index. First page: empty cursor. Every later call: pass back `next_cursor` verbatim; empty `next_cursor` = end of history. No `has_more` boolean — two sources of truth for one fact invite drift.

The cursor is opaque base64 over `{"chat_id", "t", "i"}` — the chat id is embedded, so a cursor from another chat is `INVALID_ARGUMENT`, and the keyset tuple makes concurrent appends harmless: a page in flight never skips or duplicates, new messages appear above the first page. The server fetches `limit + 1` to detect the end and shape the next cursor; the client never counts. HMAC-signing is skipped — the only caller is the internal BFF.

| Call (limit 3, messages m1…m10) | Returns |
|---------------------------------|---------|
| `GetChatHistory(chat1)` | m10, m9, m8 + `cursor_C1` |
| `GetChatHistory(chat1, C1)` | m7, m6, m5 + `cursor_C2` |
| `GetChatHistory(chat1, C2)` | m4, m3, m2 + `cursor_C3` |
| `GetChatHistory(chat1, C3)` | m1 + empty cursor |

## Rate limiting

Per-user burst limits on the write surface, enforced by a connect interceptor beside the auth interceptor — one procedure → scope map owns the policy; handlers stay business-only.

- **Scopes** — `create` covers `CreateChat`; `write` covers `SaveUserMessage` and `SaveAnalysisMessage` as one shared budget (an analysis flow does 2–4 writes). Reads are not limited in v1.
- **Business quotas stay at the edge** — the web BFF owns daily usage accounting (`FREE_TIER_LIMIT`, idempotent `eventId` dedup); chats runs only operational burst protection and never duplicates the business rule.
- **Numbers are deployment-owned** — limits resolve through the config plane (`RATE_LIMIT_*`), with the factory failing closed to conservative defaults when keys are unset.
- **Fail open, always** — Redis down means the check is skipped and counted, never rejected; the same "Redis never fails an RPC" rule the cache plane obeys.
- Over-limit answers `RESOURCE_EXHAUSTED` with retry-hint metadata (below).

## Errors

| Condition | Connect code |
|-----------|--------------|
| Identity missing or invalid | `UNAUTHENTICATED` |
| Validation: empty/oversize content or title, missing `source_message_id`, `COMPLETED` without `analysis`, `FAILED` without `error`, unknown enum values, malformed cursor, foreign cursor | `INVALID_ARGUMENT` |
| Chat missing or not owned; message id bound to another chat | `NOT_FOUND` |
| Analysis write into a terminal state (`COMPLETED`/`FAILED`/`CANCELLED`) that is not an identical replay | `FAILED_PRECONDITION` |
| Mongo unavailable | `UNAVAILABLE` |
| Per-user burst limit exceeded (`create`/`write` scopes) | `RESOURCE_EXHAUSTED`, with retry-hint metadata |
| Anything unexpected | `INTERNAL` |

Redis never fails an RPC: reads degrade to Mongo on miss/eviction, a failed invalidation is logged and absorbed (the TTL bounds staleness). Only Mongo faults map to `UNAVAILABLE`.

## Transport and codegen

connect-go mounted on the existing gin engine — the `grpchealth` surface and `/api/v1` probes are unchanged. The server speaks HTTP/1 + unencrypted H2C (already set in `cmd/api/main.go`); connect-go negotiates gRPC, gRPC-Web, and the Connect protocol on one handler. The contract source of truth is `services/chats/proto/chat_service.proto`; `buf generate` emits the Go stubs (`package chatv1`) beside it, and a connect-es TypeScript client for the BFF comes with the consumer work; the generated client is the sanctioned cross-service artifact.

## Resolved decisions

1. **Eight RPCs, mined from the caller** — `apps/web/lib/domain/chat-service.ts` is the spec; everything else is speculative surface.
2. **Identity from metadata, never the payload** — spoofable `user_id` fields are the pre-rebuild contract's worst flaw.
3. **Resources instead of `bool success`** — errors are codes; success responses carry state the caller would otherwise re-fetch.
4. **Keyset pagination with an opaque, chat-bound cursor** — offset pagination skips/duplicates under concurrent appends; the cursor chain composes `GetChat` → `GetChatHistory` across one index.
5. **Two message verbs instead of one blob** — user messages are insert-only; analysis messages are upserts with a state machine. The payload split is real: analysis messages carry no content.
6. **Idempotent writes on client-supplied ids** — duplicate user-message save = replay, analysis saves re-send the same id across the state machine, delete is idempotent.
7. **No streaming RPCs** — chats is a synchronous store; the BFF streams inference directly.
8. **Api key for the caller, trusted header for the user** — the only caller is the web BFF, so a shared secret plus the `x-user-id` header it asserts closes the spoofing surface without a second credential system. A JWT earns its keep only if the browser ever reaches chats directly.

## Open questions

1. **Terminal-state enforcement** — reject non-replay writes into a terminal analysis state (`FAILED_PRECONDITION`) vs last-write-wins. Recommendation: enforce; the BFF's cancel-after-failure path can double-write the same terminal state, which the replay rule admits.
2. **User-message replay** — return existing without overwrite (recommended) vs blind overwrite (preview-db's `put`).
