# Validation

This document explains how the Chats service checks that user input is correct and secure.

## Why Validation Matters

Validation protects the service by:
- **Preventing bad data** - Ensures only valid messages are stored
- **Protecting users** - Makes sure users can only access their own chats
- **Maintaining performance** - Rejects oversized requests early

## Authentication: Who Are You?

Every request must identify the user. The service supports two ways:

### Method 1: Header (Preferred)

```bash
grpcurl -H "x-user-id: user123" localhost:50051 chat.ChatService/GetChat
```

### Method 2: Body Field

```bash
grpcurl -d '{"user_id": "user123"}' localhost:50051 chat.ChatService/CreateChat
```

### What Happens with Authentication

| Scenario | Result |
|----------|--------|
| Header present | Use header value |
| Body present (no header) | Use body value |
| Both present and match | Use header value |
| Both present but differ | **Error: Permission Denied** |
| Neither present | **Error: Unauthenticated** |

**Why reject mismatches?** This prevents someone from pretending to be another user.

## Input Limits

Each field has specific rules to ensure data quality:

### Chat Title

| Rule | Why |
|------|-----|
| Maximum 200 characters | Prevents oversized database entries |
| Cannot be empty | Every chat needs a name |
| Extra spaces removed | Keeps data clean |

**Valid examples:**
- `"My Chat"` ✓
- `"Chat about project X"` ✓
- `"a"` ✓ (single character is okay)

**Invalid examples:**
- `""` ✗ (empty)
- `"a"` repeated 201 times ✗ (too long)

### Message Content

| Rule | Why |
|------|-----|
| Maximum 20,000 characters | Prevents memory issues |
| Cannot be empty | Empty messages aren't useful |
| Extra spaces removed | Keeps data clean |

**Valid examples:**
- `"Hello"` ✓
- `"This is a longer message..."` ✓

**Invalid examples:**
- `""` ✗ (empty)
- Content with 20,001+ characters ✗ (too long)

### Message Role

Messages must have a role indicating who sent them:

| Role | What It Means |
|------|---------------|
| `user` | Message from a human |
| `assistant` | Message from the AI |
| `system` | System message (instructions) |
| `tool` | Message from a tool |

**Rules:**
- If no role is provided, defaults to `user`
- Unknown roles are rejected
- Maximum 20 characters

### Timestamps

| Rule | Why |
|------|-----|
| Cannot be in the future (more than 5 minutes) | Prevents bad data |
| Accepts seconds or milliseconds | Flexible input |
| Zero value becomes current time | Convenience |

**Examples:**
- `1725900000` ✓ (seconds since 2024)
- `1725900000000` ✓ (milliseconds)
- Future timestamp ✗ (rejected)

## Pagination Rules

When getting chat history:

| Parameter | Default | Maximum | Why |
|-----------|---------|---------|-----|
| `page` | 1 | No limit | Start from page 1 |
| `page_size` | 20 | 100 | Balance speed vs. completeness |

**Special case:** If you request a page that would skip more than 1 million messages, you get an empty result (not an error). This prevents accidental performance issues.

## Error Messages

When validation fails, you get clear error messages:

| Error Code | Meaning | How to Fix |
|------------|---------|------------|
| `INVALID_ARGUMENT` | Bad input | Check your request |
| `UNAUTHENTICATED` | Not logged in | Add user ID |
| `PERMISSION_DENIED` | Not allowed | Check you own this chat |
| `NOT_FOUND` | Doesn't exist | Check the chat ID |

## Examples

### Creating a Chat

```bash
# Valid request
grpcurl -d '{
  "user_id": "user123",
  "title": "My New Chat"
}' localhost:50051 chat.ChatService/CreateChat

# Invalid: empty title
grpcurl -d '{
  "user_id": "user123",
  "title": ""
}' localhost:50051 chat.ChatService/CreateChat
# Returns: INVALID_ARGUMENT
```

### Saving a Message

```bash
# Valid request
grpcurl -d '{
  "chat_id": "chat-123",
  "user_id": "user123",
  "role": "user",
  "content": "Hello, world!"
}' localhost:50051 chat.ChatService/SaveMessage

# Invalid: message too long
grpcurl -d '{
  "chat_id": "chat-123",
  "user_id": "user123",
  "role": "user",
  "content": "a" * 20001
}' localhost:50051 chat.ChatService/SaveMessage
# Returns: INVALID_ARGUMENT
```

## Next Steps

- [Caching](../concepts/caching.md) - How the cache speeds up responses
- [API Reference](api.md) - Complete API documentation
