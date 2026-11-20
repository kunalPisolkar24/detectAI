# Specification Index

Specifications for the inference service. This file is the hub — every design doc links to related specs. For usage-level documentation see [docs/](../docs/README.md).

## Specs

| Doc | Covers |
| --- | --- |
| [requirements.md](requirements.md) | what the service must do, its bounds, and what is out of scope |
| [design.md](design.md) | module layout, boot runtime model, error taxonomy, decisions |
| [api-contract.md](api-contract.md) | the `inference.v1` wire contract and its pinned semantics |
| [pipeline.md](pipeline.md) | preprocessing, overlap, scoring, and aggregation |
| [models.md](models.md) | artifact pull, revision verification, load, warmup, CPU/GPU |
| [observability.md](observability.md) | metric and span inventory, export contract |

## Read order

[requirements.md](requirements.md) first, then [design.md](design.md) for the seams, then the slice that answers your question. Each doc states its decisions at the bottom with rationale, so choices survive their authors.

## References

| Doc | Covers |
| --- | --- |
| [references/config.md](references/config.md) | settings resolution, plane selection, and fail-closed rules |
