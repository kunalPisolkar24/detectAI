# API Reference

This document explains how to use the Chats service API. The API uses **gRPC** (a fast, efficient way for applications to communicate).

## Getting Started

### Prerequisites

To use the API, you need:

- A running Chats service (see [Configuration](../getting-started/configuration.md))
- A gRPC client (like `grpcurl` for testing)

### Base URL

The API runs on port `50051` by default:

```
localhost:50051
```

## Available Methods

### Create a New Chat

**What it does:** Creates a new chat session.

**Request:**

```bash
grpcurl -plaintext -d '{
  "user_id": "user123",
  "title": "My New Chat"
}' localhost:50051 chat.ChatService/CreateChat
```

**Response:**

```json
{
  "chat_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**What each field means:**


| Field     | Type   | Description                     |
| --------- | ------ | ------------------------------- |
| `user_id` | string | Your unique user identifier     |
| `title`   | string | Chat title (max 200 characters) |




### Get a Chat

**What it does:** Retrieves details about a specific chat.

**Request:**

```bash
grpcurl -plaintext -H "x-user-id: user123" \
  -d '{"chat_id": "550e8400-e29b-41d4-a716-446655440000"}' \
  localhost:50051 chat.ChatService/GetChat
```

**Response:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user123",
  "title": "My New Chat",
  "created_at": 1725900000,
  "updated_at": 1725900000
}
```

**Important:** You must be the owner of the chat to access it.

### List Your Chats

**What it does:** Returns all chats for a user.

**Request:**

```bash
grpcurl -plaintext -d '{
  "user_id": "user123",
  "limit": 10
}' localhost:50051 chat.ChatService/GetUserChats
```

**Response:**

```json
{
  "chats": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "My New Chat",
      "updated_at": 1725900000
    }
  ]
}
```



### Rename a Chat

**What it does:** Changes the title of a chat.

**Request:**

```bash
grpcurl -plaintext -d '{
  "chat_id": "550e8400-e29b-41d4-a716-446655440000",
  "new_title": "Updated Chat Title"
}' localhost:50051 chat.ChatService/RenameChat
```



### Delete a Chat

**What it does:** Permanently deletes a chat and all its messages.

**Request:**

```bash
grpcurl -plaintext -d '{
  "chat_id": "550e8400-e29b-41d4-a716-446655440000"
}' localhost:50051 chat.ChatService/DeleteChat
```

**Warning:** This cannot be undone!

### Save a Message

**What it does:** Saves a message to a chat. The message is published to a stream for async persistence by the Worker. If the stream is unavailable, the API falls back to writing directly to MongoDB (see [Streaming](streaming.md)).

**Request:**

```bash
grpcurl -plaintext -d '{
  "chat_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user123",
  "role": "user",
  "content": "Hello, how are you?",
  "metadata": {
    "source": "web",
    "session": "abc-123"
  },
  "message_id": "660e8400-e29b-41d4-a716-446655440000",
  "created_at": 1725900000
}' localhost:50051 chat.ChatService/SaveMessage
```

**All request fields:**

| Field         | Type               | Required | Description |
| ------------- | ------------------ | -------- | ----------- |
| `chat_id`     | string             | Yes      | The chat to save the message to |
| `user_id`     | string             | Yes      | Your unique user identifier |
| `role`        | string             | No       | Message role (defaults to `user` if omitted) |
| `content`     | string             | Yes      | Message text (max 20,000 characters) |
| `metadata`    | map<string,string> | No       | Arbitrary key-value pairs (e.g. `source`, `session`) for your own bookkeeping |
| `message_id`  | string             | No       | Your own ID for the message. If a message with this ID already exists, the save is a no-op (idempotent). Generated automatically if omitted. |
| `created_at`  | number (Unix)      | No       | Timestamp in seconds. Must not be more than 5 minutes in the future. Defaults to current time if omitted. |

**Response:**

```json
{
  "message_id": "660e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1725900000
}
```

**Message roles:**

| Role        | What It Means                 |
| ----------- | ----------------------------- |
| `user`      | Message from a human          |
| `assistant` | Message from the AI           |
| `system`    | System message (instructions) |
| `tool`      | Message from a tool           |




### Get Chat History

**What it does:** Retrieves messages from a chat.

**Request:**

```bash
grpcurl -plaintext -d '{
  "chat_id": "550e8400-e29b-41d4-a716-446655440000",
  "page": 1,
  "page_size": 20
}' localhost:50051 chat.ChatService/GetChatHistory
```

**Response:**

```json
{
  "messages": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "chat_id": "550e8400-e29b-41d4-a716-446655440000",
      "user_id": "user123",
      "role": "user",
      "content": "Hello, how are you?",
      "metadata": {
        "source": "web"
      },
      "analysis": {
        "human_score": 0.95,
        "ai_score": 0.05,
        "model_name": "detect-v2",
        "verdict": "human"
      },
      "created_at": 1725900000
    }
  ],
  "has_more": false
}
```

**Message fields in response:**

| Field       | Type               | Description |
| ----------- | ------------------ | ----------- |
| `id`        | string             | Unique message ID |
| `chat_id`   | string             | The chat this message belongs to |
| `user_id`   | string             | Who sent the message |
| `role`      | string             | `user`, `assistant`, `system`, or `tool` |
| `content`   | string             | Message text |
| `metadata`  | map<string,string> | Arbitrary key-value pairs (if provided when saving) |
| `analysis`  | object \| null     | AI detection analysis (if available — see below) |
| `created_at`| number (Unix)      | When the message was created |

**Analysis fields (when present):**

| Field         | Type   | Description |
| ------------- | ------ | ----------- |
| `human_score` | float  | Probability text is human-written (0.0 to 1.0) |
| `ai_score`    | float  | Probability text is AI-generated (0.0 to 1.0) |
| `model_name`  | string | Which detection model produced the analysis |
| `verdict`     | string | `human`, `ai`, or `mixed` |

**Pagination:**

- `page`: Page number (starts at 1)
- `page_size`: Messages per page (max 100, default 20)
- `has_more`: True if there are more messages



## Error Codes

When something goes wrong, the API returns these error codes:


| Code                | Meaning       | How to Fix              |
| ------------------- | ------------- | ----------------------- |
| `OK`                | Success       | -                       |
| `INVALID_ARGUMENT`  | Bad input     | Check your request      |
| `UNAUTHENTICATED`   | Not logged in | Add user ID             |
| `PERMISSION_DENIED` | Not allowed   | Check you own this chat |
| `NOT_FOUND`         | Doesn't exist | Check the chat ID       |
| `INTERNAL`          | Server error  | Try again later         |




## Common Examples



### Complete Chat Flow

```bash
# 1. Create a chat
CHAT_ID=$(grpcurl -plaintext -d '{
  "user_id": "user123",
  "title": "Test Chat"
}' localhost:50051 chat.ChatService/CreateChat | jq -r .chat_id)

# 2. Save a message
grpcurl -plaintext -d "{
  \"chat_id\": \"$CHAT_ID\",
  \"user_id\": \"user123\",
  \"role\": \"user\",
  \"content\": \"Hello!\"
}" localhost:50051 chat.ChatService/SaveMessage

# 3. Get history
grpcurl -plaintext -d "{
  \"chat_id\": \"$CHAT_ID\",
  \"page\": 1,
  \"page_size\": 10
}" localhost:50051 chat.ChatService/GetChatHistory
```



### Health Check

```bash
# Check if service is healthy
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
```



## Tips

1. **Use headers for authentication** - The `x-user-id` header is preferred
2. **Handle errors gracefully** - Check error codes in your code
3. **Use pagination** - Don't request all messages at once
4. **Validate input** - The API will reject invalid requests
5. **Use `message_id` for idempotent writes** - If you provide your own `message_id` in `SaveMessage`, duplicate saves are silently ignored. This is useful for retries without creating duplicates.
6. **Use `metadata` to tag messages** - Attach custom key-value pairs (like `source: "mobile"`) for your own bookkeeping.



## Related Documentation

- [Validation](validation.md) - Input validation rules
- [Configuration](../getting-started/configuration.md) - API settings
- [Architecture](../concepts/architecture.md) - How the API fits in the system

