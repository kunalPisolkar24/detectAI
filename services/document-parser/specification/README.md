# Specification Index

Specifications for the document-parser service. This file is the hub — every design doc links to related specs.

## Specs

| Doc | Covers |
|-----|--------|
| [requirements.md](requirements.md) | Functional and non-functional requirements, bounds, out-of-scope, deployment target |
| [http.md](http.md) | The HTTP wire contract — endpoints, JSON shapes, status codes, semantics |
| [cleaning.md](cleaning.md) | Text fidelity — per-format suppression rules, shared normalizer, knobs, gaps |
| [observability.md](observability.md) | OTel pipeline (push, no pull endpoint) and the metric inventory |
| [design.md](design.md) | Module layout, runtime model, PDF library choice, Lambda packaging, testing strategy |

## Planned docs

None. `design.md` was the last planned doc and is drafted above.

## References

Review artifacts kept outside the hub list:

- [references/config.md](references/config.md) — LLD for per-plane config resolution: ENV_TYPE flick, provider planes (dev env-over-file, prod AWS-exact), factory composition, and the fail-fast contract
- [references/validation.md](references/validation.md) — LLD for upload validation: the layered admission model (transport → magic sniff → container open → per-type bounds), the typed error vocabulary and its HTTP mapping, and the fail-closed bounds contract
