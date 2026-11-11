# Specification Index

Specifications for the chats service. This file is the hub — every design doc links to related specs. The quarantined pre-rebuild build-out (`slop/`) is reference material only.

## Specs

| Doc | Covers |
|-----|--------|
| [contract.md](contract.md) | The Connect RPC wire contract — RPC surface, types, pagination, error semantics, codegen |

## Read order

[contract.md](contract.md) first (what the service must answer), then the [data model LLD](references/data-model.md) (how it is stored). Every doc states its resolved decisions at the bottom with rationale, so choices survive their authors.

## References

- [references/data-model.md](references/data-model.md) — LLD for the data layer: the `chats` and `messages` documents, indexes, and the Redis cache overlay

## Planned

| Doc | Covers |
|-----|--------|
| `requirements.md` | Functional and non-functional requirements, bounds, out-of-scope, deployment target |
| `design.md` | Module layout, runtime model, config planes, packaging, testing strategy |
| `observability.md` | The OTel push pipeline, metric inventory, current assets |
