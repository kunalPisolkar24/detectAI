# Specification Index

Specifications for the chats service. This file is the hub — every design doc links to related specs. The quarantined pre-rebuild build-out (`slop/`) is reference material only.

## Specs

| Doc | Covers |
|-----|--------|
| [contract.md](contract.md) | The Connect RPC wire contract — RPC surface, types, pagination, rate limiting, error semantics, codegen |
| [observability.md](observability.md) | The OTel push pipeline to New Relic, the metric inventory, the telemetry seam |

## Read order

[contract.md](contract.md) first (what the service must answer), then the [data model LLD](references/data-model.md) (how it is stored). Every doc states its resolved decisions at the bottom with rationale, so choices survive their authors.

## References

- [references/data-model.md](references/data-model.md) — LLD for the data layer: the `chats` and `messages` documents, indexes, and the Redis cache overlay
- [references/cache.md](references/cache.md) — LLD for the cache plane: shared-instance namespacing, key inventory, TTLs, eviction, and cutover

## Planned

| Doc | Covers |
|-----|--------|
| `requirements.md` | Functional and non-functional requirements, bounds, out-of-scope, deployment target |
| `design.md` | Module layout, runtime model, config planes, packaging, testing strategy |
