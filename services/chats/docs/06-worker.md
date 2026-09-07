# Worker

`SERVICE_ROLE=worker` runs `Consumer.Start` — one goroutine per partition + one recovery loop (`consumer.go:48`).

## Consume loop

```mermaid
graph TB
    Start[Start partitions N] --> W[runWorker p]
    W --> EG[ensureGroup MkStream 0]
    EG --> Read[XReadGroup Block 2s Count=BATCH_SIZE]
    Read -->|msgs| PB[ProcessBatch]
    Read -->|nil/err| Back[1s backoff / continue]
    PB --> Ack[XAck pipeline]
    W --> Lag[lagReporter 5s XInfoGroups]
    Start --> Rec[runRecovery 30s]
```

Consumer names are unique per restart (`hostname-p<id>-<rand>`) so crashed consumers leave PEL entries for recovery instead of blocking the group.

## ProcessBatch (`processor.go:32`)

```mermaid
sequenceDiagram
    participant C as Consumer
    participant P as Processor
    participant M as Mongo
    participant R as Redis
    C->>P: ProcessBatch streams, client, group
    P->>P: extract data string/bytes + json.Unmarshal + id/chat_id check
    alt poison
        P->>R: XAck immediately + IncStreamErrors
    else valid batch
        P->>M: BulkUpsertMessages
        alt upsert ok
            P->>P: AddIngestedMessages n
            P->>R: XAck pipeline
        else upsert fail
            P->>P: IncDatabaseErrors bulk_upsert
            P->>R: SAdd chat:dlq:messages + Expire 7d + XAck
        end
    end
```

* Empty batch with only poison still `XAck`s via pipeline so streams never wedge; `ack` failures only log + metric.
* `BulkUpsertMessages` skips `nil/empty id/chat_id`, fills zero `CreatedAt=now`, then per-message upsert into bucketed `messages` collection (see `03-internals` split: persistence lives in mongo buckets, capacity `50`, window `24h`).
* DLQ is a `SET chat:dlq:messages` (message stream-IDs, not payloads) with `DLQTTL 7d`; count via `chat_dlq_messages_total`.

## Recovery (`runRecovery`)

Every `RecoveryInterval 30s`, per partition `XAutoClaim MinIdle RecoveryIdle 60s Count 50` from `0-0` until cursor `0-0`, re-`ProcessBatch`ing claimed entries as `<host>-recover-<p>`. Handles worker crash/network blip where PEL entries outlive the consumer. `NOGROUP` during autoclaim is ignored (group recreated by `runWorker`).

Tuning: raise `BATCH_SIZE (1..500)` for throughput (memory + mongo bulk time), `STREAM_PARTITION_COUNT (1..128)` for parallelism (more goroutines + streams), lower `RecoveryIdle` for faster steal (duplicate-processing risk — upsert is idempotent by `message_id`).
