# HA Tests

Needs Docker. Run with `make test-ha`.

```bash
make test-ha
```

Same images as integration but with HA flags: single-node replica set and auth plus replica.

## Depth

**Mongo** — verifies idempotent sharding setup on a replica set, shard-key isolation so history never leaks across chats, idempotent and large-batch upserts, HA connection pool and timeout handling, and pagination on the replica set.

**Redis** — verifies publish and cache under auth, primary remains available after replica loss, wrong password is rejected, Lua deduplication stays single-shard safe, connection error detection for failover, and partition routing isolation.

**Worker** — verifies full consume path on replica set plus auth, resilience when redis restarts, poison and isolation handling under HA, and large batch persistence on the replica set.

Fixtures are in `internal/testutil` with HA variants. Config is test-only and never wired into compose.
