# Sharded Cluster Tests

This document explains how the Chats service tests MongoDB sharding — the mechanism that lets the database scale horizontally across multiple servers.

## What is Sharding?

Imagine you have a huge filing cabinet that's getting too full. Instead of buying a bigger cabinet, you split the files across two smaller cabinets and put a receptionist in front who knows which cabinet holds which file. That's sharding.

**In technical terms:** Sharding splits a single MongoDB collection across multiple servers (shards). A router (mongos) sits in front and directs each query to the right shard based on a **shard key**.

## Why Does the Chat Service Use Sharding?

The `messages` collection can grow very large. Sharding on `chat_id` (using a hashed key) means:

- Messages for different chats are distributed evenly across shards
- Queries for a specific chat go to exactly one shard (no scanning all shards)
- The system can scale by adding more shards

The `chats` collection stays unsharded because it's small metadata — broadcasting it across shards would add complexity for no benefit.

## How the Test Cluster Works

Sharded tests spin up a **real 5-container MongoDB cluster** using Docker. This is the minimum topology that exercises the same code path as production:

```
                    ┌─────────────┐
                    │   mongos    │  ← Router (connects here)
                    │  :27017     │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │                         │
     ┌────────┴────────┐     ┌─────────┴────────┐
     │  configsvr RS   │     │                  │
     │  (cfg0)         │     │                  │
     │  :27019         │     │                  │
     └─────────────────┘     │                  │
                             │                  │
                    ┌────────┴───┐    ┌─────────┴───┐
                    │ shard0 RS  │    │ shard1 RS   │
                    │ (shard0)   │    │ (shard1)    │
                    │ :27018     │    │ :27018      │
                    └────────────┘    └─────────────┘
```

| Container | Role | What It Does |
|-----------|------|--------------|
| `mongo-cfg` | Config server | Stores cluster metadata (which collections are sharded, where chunks live) |
| `mongo-shard0` | Shard 0 | Holds a portion of the data |
| `mongo-shard1` | Shard 1 | Holds the other portion of the data |
| `mongo-mongos` | Router | Directs queries to the correct shard |
| Docker network | Isolation | All containers communicate on a private network |

Each shard is a single-node replica set (minimal but real). The test fixture lives in `internal/testutil/containers_sharded.go`.

## What Each Test Verifies

### Core Contract Tests (`TestSharded_Contracts`)

These tests prove that sharding actually works through mongos:

| Test | What It Checks | Why It Matters |
|------|----------------|----------------|
| `EnsureShardingSucceedsViaMongos` | `enableSharding` + `shardCollection` work via mongos; idempotent on repeat calls | Confirms the sharding setup code works against a real mongos (not just a standalone mongod) |
| `ChatsRemainsUnsharded` | The `chats` collection is NOT sharded, but still usable via mongos | Validates our design choice: only shard large collections, keep small ones broadcast |
| `StandaloneIsNoopOnMongos` | `MONGO_MODE=standalone` never shards, even when mongos is available | Ensures the mode flag is respected — standalone mode must never accidentally shard |
| `CrossChatIsolationViaMongos` | Queries for chat A never return messages from chat B | Verifies that the shard key (`chat_id`) correctly isolates data across chats |
| `BulkUpsertIdempotentViaMongos` | Writing the same message twice doesn't create duplicates | Confirms idempotent writes work correctly through the router |
| `LargeBatchMultiBucketViaMongos` | 120 messages (exceeding bucket capacity of 50) are stored and retrievable | Proves the bucketing strategy works when data spans multiple internal buckets |
| `PaginationViaMongos` | Paging through results (offset 0, 10, 20...) returns correct, non-overlapping pages | Validates pagination works correctly when data is spread across shards |
| `TargetedQueryUsesShardKey` | Queries filtering on `chat_id` explain as `SINGLE_SHARD` (not scatter-gather) | This is the key performance win — targeted queries hit one shard, not all |

### Connection Config Test (`TestSharded_ConnectConfig`)

Proves that `database.ConnectMongo` with production sharded defaults (pool size 20/5, 15s timeout, `retryWrites=false`) works against mongos. This is the exact connection path used in production.

### Chunk Distribution Test (`TestSharded_ChunkDistribution`)

Writes 20 messages with different `chat_id` values and verifies that the hashed shard key causes chunks to be pre-split across both shards. This confirms the balancer and router are wired correctly.

### Shard Failure Test (`TestSharded_ShardFailure`)

Kills one shard container and verifies that:
- Reads for data on the surviving shard return full results (no silent partial data)
- Reads for data on the dead shard fail fast with an error (no hanging or wrong data)

This is critical for HA: the service must never return silently-truncated results.

### Worker E2E Test (`TestSharded_Worker_EndToEnd`)

Runs the full persistence path against the real sharded cluster:
1. Publishes messages to a Redis stream
2. Worker consumer picks them up
3. Worker calls `BulkUpsert` which lands on the sharded MongoDB via mongos
4. `GetHistory` via mongos returns the persisted messages

This proves the entire pipeline works end-to-end with `MONGO_MODE=sharded`.

## Running Sharded Tests

```bash
# Run all sharded cluster tests (takes ~60-90s per test for cluster bootstrap)
make test-sharded

# Run a specific sharded test
go test -v -tags integration -timeout=900s -run TestSharded_Contracts -count=1 ./...

# Run sharded tests with short mode disabled (required — they skip in short mode)
go test -v -tags integration -timeout=900s -run TestSharded -count=1 ./internal/adapters/mongo/
```

### Prerequisites

- **Docker** must be running (tests use testcontainers)
- **~900s timeout** — cluster bootstrap takes 60-90s per test
- **Build tag `integration`** — sharded tests use this tag (same as other integration tests)

### What to Expect

- Each test creates its own database (random name) so tests don't interfere
- The cluster is torn down automatically after each test
- First run downloads `mongo:7` Docker image if not cached
- Tests skip automatically with `testing.Short()` — always run without `-short`

## Test Fixture Details

The `ShardedMongoFixture` in `internal/testutil/containers_sharded.go` handles:

1. Creating an isolated Docker network
2. Starting the config server replica set
3. Starting both shard replica sets
4. Starting mongos connected to the config server
5. Adding both shards via `sh.addShard()`
6. Waiting until `listShards` reports 2 active shards
7. Connecting a Go MongoDB driver client to mongos

The fixture provides:
- `MongosClient` — connected Go driver client
- `MongosURI` — connection string for `database.ConnectMongo`
- `DB` — default database handle
- `Shard0Container` / `Shard1Container` — for failure tests

## Troubleshooting

### "Skipping sharded cluster test in short mode"

Tests are skipped when `-short` is passed. Run without it:
```bash
go test -v -tags integration -timeout=900s -run TestSharded -count=1 ./...
```

### "mongos never became reachable"

The mongos container failed to start. Check:
- Docker is running: `docker ps`
- Ports aren't in use: `docker ps --format '{{.Ports}}'`
- Container logs: `docker logs <mongos-container-id>`

### "Cluster bootstrap takes too long"

Each test starts 5 containers and waits for replica set elections. On slow machines this can take 2-3 minutes. The 900s timeout should be sufficient. If it consistently times out, check Docker resource limits.

### "Tests fail intermittently"

Sharded tests are deterministic but depend on:
- Docker container startup timing (handled by retry loops)
- Replica set elections (single-node RS, usually fast)
- Mongos accepting connections (retried 30 times with 1s sleep)

If flaky, check Docker logs for container crashes.

## Key Concepts

| Term | Plain English |
|------|---------------|
| **Shard key** | The field MongoDB uses to decide which shard holds each document. We use `chat_id:hashed`. |
| **Hashed shard key** | MongoDB hashes the shard key value to distribute data evenly (avoids hotspots). |
| **Mongos** | The router — sits between your app and the shards, directs each query to the right shard. |
| **Config server** | Stores cluster metadata (what's sharded, where chunks live). |
| **Chunk** | A range of shard key values. MongoDB splits and migrates chunks to balance data across shards. |
| **SINGLE_SHARD** | An `explain()` output meaning the query was targeted to exactly one shard (good!). |
| **Scatter-gather** | A query that hits all shards and merges results (slow — we avoid this with proper shard key usage). |
| **RetryWrites=false** | MongoDB driver setting required for sharded clusters (and DocumentDB). |

## Related Documentation

- [Testing Overview](overview.md) — All testing levels
- [Integration Tests](integration.md) — Testing with real databases
- [HA Tests](ha.md) — High availability testing
- [Architecture](../concepts/architecture.md) — How the service is structured
- [Configuration](../getting-started/configuration.md) — `MONGO_MODE` and other settings
