# Integration Tests

Needs Docker. Run with `make test-integration`.

```bash
make test-integration
```

Single-node containers: `mongo:7` and `redis:7-alpine` via `internal/testutil`.

## Depth

**Chat flow** — starts a real gRPC server with live mongo and redis, exercises create session, save messages, and fetch history, plus unauthorized access, multi-session listing, and rename plus delete.

**Worker** — consumes from real streams and persists to mongo, handles poison pills without blocking and processes valid messages after them.

**Mongo repository** — uses real mongo to verify indexes, bulk upserts, and history fetching under realistic storage.

**Redis cache and streams** — uses real redis to verify cache save and fetch and stream publish and routing.

Fixtures are in `internal/testutil`.
