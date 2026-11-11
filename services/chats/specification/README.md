# Specification Index

Specifications for the chats service. This file is the hub — every design doc links to related specs. The quarantined pre-rebuild build-out (`slop/`) is reference material only.

## Specs

| Doc | Covers |
|-----|--------|
| [references/data-model.md](references/data-model.md) | LLD for the data layer — the `chats` and `messages` documents, indexes, and the Redis cache overlay |

## Planned

| Doc | Covers |
|-----|--------|
| `requirements.md` | Functional and non-functional requirements, bounds, out-of-scope, deployment target |
| `contract.md` | The Connect RPC wire contract — RPC surface, auth metadata, error semantics, codegen |
| `design.md` | Module layout, runtime model, config planes, packaging, testing strategy |
| `observability.md` | The OTel push pipeline, metric inventory, current assets |
