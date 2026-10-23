# Specification Index

Specifications for the document-parser service. This file is the hub — every design doc links to related specs.

## Specs

| Doc | Covers |
|-----|--------|
| [requirements.md](requirements.md) | Functional and non-functional requirements, bounds, out-of-scope |
| [http.md](http.md) | The HTTP wire contract — endpoints, JSON shapes, status codes, semantics |
| [cleaning.md](cleaning.md) | Text fidelity — per-format suppression rules, shared normalizer, knobs, gaps |
| [observability.md](observability.md) | OTel pipeline (push, no pull endpoint) and the metric inventory |

## Planned docs

- `design.md` — module layout, config and secrets, worker pool model, testing strategy (starts once HTTP/observability are stable)
