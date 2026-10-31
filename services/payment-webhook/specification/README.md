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

## Planned docs

None at spec level. Service-level LLDs land in `references/` as the build crystallizes them:

- `references/config.md` — per-plane config resolution: dev env-over-file, prod AWS-exact (Secrets Manager blob + SSM), factory composition, fail-fast contract
- `references/enqueue.md` — the SQS adapter LLD: client construction, FIFO attribute wiring, enqueue duration/timeout handling
- `references/auth.md` — the two validators' LLDs: Paddle HMAC (`ts=`/`h1=` FSM) and the internal key comparison; typed verdicts and their HTTP mapping

## References

Review artifacts kept outside the hub list:

Nothing yet — the specs above are the first artifacts. Like the document-parser build, `slop/` stays beside this tree as frozen reference material until the `worker-payments` cutover removes its last consumer.

## Read order

Requirements first, then the three contract docs ([http](http.md) · [messaging](messaging.md) · [observability](observability.md)), then [design.md](design.md). Every doc states its resolved decisions at the bottom with rationale recorded so choices survive their authors.
