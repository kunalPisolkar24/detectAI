# Specification Index

Specifications for the payment-webhook service. This file is the hub — every design doc links to related specs.

## Specs

| Doc | Covers |
|-----|--------|
| [requirements.md](requirements.md) | Functional and non-functional requirements, bounds, out-of-scope, deployment target, knock-ons |
| [http.md](http.md) | The HTTP wire contract — endpoints, auth, JSON shapes, status codes, semantics |
| [messaging.md](messaging.md) | Delivery fidelity — the SQS FIFO decision, message shape, dedup/group keys, DLQ, worker and cutover notes |
| [observability.md](observability.md) | What is monitored — the OTel push pipeline, the metric inventory, the verdict→instrument mapping, board/policy migration |
| [design.md](design.md) | Module layout, runtime model, config planes, packaging, testing strategy |

## Read order

Requirements first, then the three contract docs ([http](http.md) · [messaging](messaging.md) · [observability](observability.md)), then [design.md](design.md). Every doc states its resolved decisions at the bottom with rationale recorded so choices survive their authors.
