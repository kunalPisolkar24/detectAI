# Unit Tests

No Docker. Run with `make test`.

```bash
make test
make test-coverage
```

## Depth

**gRPC handler** — auth via `x-user-id` header vs body, mismatch and missing auth handling, nil and invalid payloads, service error mapping to gRPC codes, timestamp and limit handling.

**Chat service** — session create and lookup with validation and ownership checks, user session listing with limit defaults and clamping, rename and delete with authorization, message processing with validation and publish plus cache, history retrieval with cache hit merge, cache miss read-repair, cold path pagination, and unauthorized cases.

**Mongo repository** — chat create and fetch, not-found handling, user chat ordering, title updates, chat deletion, message bucket upserts with idempotency and large batches, history pagination.

**Redis cache** — save and fetch recent messages, idempotent saves, empty cache handling, bulk populate, ordering, and deletion.

**Redis streams** — publishing and reading from streams, payload correctness, and partition routing across streams.

**Worker processor** — batch processing with good and poison messages, database failure to DLQ, ack handling, and byte payload support.

Mocks live in `internal/mocks`.
