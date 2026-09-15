# Streaming

This document explains how the Chats service uses streams to handle messages efficiently.

## What is Streaming?

Streaming is like a conveyor belt in a factory. Instead of processing each item one at a time (which could be slow), you put items on the belt and process them in batches later.

The Chats service uses **Redis Streams** as this conveyor belt to handle messages.

## Why Use Streams?

When a user sends a message, we want to respond quickly. But saving to the database takes time. Streams solve this problem:

**Without streams:**
1. User sends message
2. Wait for database save (slow)
3. Tell user "message saved"

**With streams:**
1. User sends message
2. Put message on stream (fast)
3. Tell user "message received"
4. Later: Worker saves to database

The user gets a fast response, and the message is saved reliably in the background.

## How Streaming Works

### Sending Messages

```mermaid
graph TB
    A[User sends message] --> B[API receives message]
    B --> C[Validate message]
    C --> D[Add to stream]
    D --> E[Update cache]
    E --> F[Respond to user]
```

**What happens:**
1. User sends a message
2. API validates the message
3. API adds the message to a Redis Stream
4. API updates the cache
5. API immediately responds to the user

### Receiving Messages (Worker)

```mermaid
graph TB
    A[Worker starts] --> B[Listen to stream]
    B --> C{New messages?}
    C -->|Yes| D[Pick up messages]
    C -->|No| B
    D --> E[Save to database]
    E --> F[Mark as processed]
    F --> B
```

**What happens:**
1. Worker starts and connects to the stream
2. Worker waits for new messages
3. When messages arrive, worker picks them up
4. Worker saves messages to the database
5. Worker marks messages as processed
6. Worker continues listening

## Stream Organization

### Partitions

The service splits messages into multiple streams called **partitions**. This helps with performance:

```
Stream 1: global:ingest:0
Stream 2: global:ingest:1
Stream 3: global:ingest:2
...
Stream 16: global:ingest:15
```

**How messages are assigned:**
- Each message has a `chat_id`
- The service calculates `crc32(chat_id) % 16`
- This determines which stream the message goes to

**Why partitions help:**
- Multiple workers can process different streams simultaneously
- Messages from the same chat stay in order
- Better performance under heavy load

### Stream Limits

| Setting | Value | Why |
|---------|-------|-----|
| Maximum messages per stream | 100,000 | Prevents memory issues |
| Trim mode | Approximate | Better performance |

The stream automatically removes old messages when it gets too full.

## Message Flow Example

Let's trace a message from user to database:

```mermaid
sequenceDiagram
    participant User
    participant API
    participant Stream as Redis Stream
    participant Worker
    participant DB as MongoDB
    
    User->>API: Send message
    API->>API: Validate
    API->>Stream: Add to stream partition 5
    API-->>User: Message received
    Stream->>Worker: Pick up message
    Worker->>DB: Save to database
    Worker->>Stream: Mark as processed
```

## Failure Handling

What happens when something goes wrong?

| Failure | What Happens | Recovery |
|---------|--------------|----------|
| Stream write fails (transient) | API falls back to sync MongoDB write | Automatic — no user action needed |
| Stream write fails (non-transient) | API returns error to user | User retries |
| Worker crashes | Messages stay in stream | Worker restarts and processes them |
| Database write fails | Message stays in stream | Worker retries |
| Message is corrupted | Message is acknowledged | Skipped (logged as error) |

**Key point:** Messages are only removed from the stream after they're successfully saved to the database.

## Degraded Mode (Redis Unavailable)

When Redis is unavailable at startup or goes down during operation, the service enters **degraded mode**:

### How It Works

```mermaid
graph TB
    A[SaveMessage called] --> B[Publish to stream]
    B -->|Success| C[Normal path: async via Worker]
    B -->|Transient error| D[Fallback: sync MongoDB write]
    D --> E[Message saved directly]
    E --> F[Best-effort cache update]
```

1. The API tries to publish to the Redis Stream
2. If the error is **transient** (connection refused, broken pipe, i/o timeout, etc.), the service falls back to writing the message directly to MongoDB
3. The cache is updated on a best-effort basis
4. The user still gets a successful response

### What Is a Transient Error?

The service classifies these as transient (retriable):
- Connection refused / reset / closed
- Broken pipe
- I/o timeout / timeout
- No such host / dial tcp errors
- "Client is closed" errors
- Any `ErrUnavailable` sentinel

### Detection and Recovery

- **API mode**: A background recovery loop attempts to reconnect to Redis every 5-30 seconds with exponential backoff. When Redis comes back, the API automatically switches back to stream-based processing.
- **Worker mode**: The Worker blocks at startup until Redis is available. It cannot process messages without the stream.
- The `redis_degraded` metric tracks the state (1 = degraded, 0 = normal).

### Trade-offs

| Aspect | Normal Mode | Degraded Mode |
|--------|-------------|---------------|
| Message save | Async (fast response) | Sync DB write (slightly slower) |
| Cache | Working | Not available |
| History reads | Cache + DB merge | DB only |
| Service availability | Full | Full (graceful degradation) |

See [Architecture](../concepts/architecture.md#degraded-mode-redis-unavailable) for the full explanation.

## Monitoring

The service tracks stream health:

| Metric | What It Tells You |
|--------|-------------------|
| `chat_redis_stream_lag` | How many messages are waiting to be processed |
| `chat_stream_errors_total` | How many stream operations failed |
| `chat_messages_published_total` | How many messages were added to streams |
| `chat_sync_fallback_total` | How many messages were saved via sync fallback (degraded mode) |
| `redis_degraded` | Whether the service is in degraded mode (1 = yes, 0 = no) |

## Configuration

You can adjust streaming behavior:

```bash
# Number of partitions (streams)
STREAM_PARTITION_COUNT=16

# How many messages to process at once
BATCH_SIZE=50

# How long to wait for new messages
ReadBlockDuration=2s
```

## Troubleshooting

**Messages not appearing in database?**
- Check if worker is running
- Look at stream lag metric
- Check worker logs for errors

**High stream lag?**
- Worker might be slow (check database performance)
- Increase `BATCH_SIZE` for faster processing
- Add more partitions for better parallelism

**Stream errors?**
- Check Redis connectivity
- Verify Redis has enough memory
- Look at error logs for specific failures

## Next Steps

- [Worker](worker.md) - How the worker processes messages
- [Health](../operations/health.md) - How to monitor the service
- [Observability](../operations/observability.md) - Metrics and alerts
