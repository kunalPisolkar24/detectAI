# RPC API

The contract is `api/proto/ai_service.proto`: package `inference.v1`, service `AIService`, two methods. This page is the client-facing view; the pinned semantics are in [specification/api-contract.md](../../specification/api-contract.md).

## Methods

| Method | Request | Response |
| --- | --- | --- |
| `Detect` | `DetectRequest` | `DetectionResult` (unary) |
| `AnalyzeDocument` | `AnalyzeDocumentRequest` | stream of `AnalyzeDocumentEvent` |

Both requests carry `text` and `model_id`. An empty `model_id` selects `spark`; a supplied value is trimmed and lowercased, and the response echoes the canonical key. A model this process does not serve answers `INVALID_ARGUMENT`.

## `DetectionResult`

| Field | Type | Meaning |
| --- | --- | --- |
| `model_id` | string | the model that answered |
| `is_ai_generated` | bool | flag at the configured threshold |
| `confidence_score` | float | the winner's confidence, 0–100 |
| `ai_confidence` | float | AI confidence, 0–100 |
| `human_confidence` | float | human confidence, 0–100 |
| `highlight_spans` | repeated `HighlightSpan` | one per scored region, in order |

All confidences are percentages rounded to one decimal. `confidence_score` mirrors `ai_confidence` when the document reads as AI, otherwise `human_confidence`. Each span carries `char_start`, `char_end`, and its own `ai_confidence` — offsets are into the submitted text, which is never rewritten.

## Stream events

`AnalyzeDocumentEvent` is a `oneof` in a fixed order:

1. `started` — `total_chars`, `total_chunks`;
2. `progress` — `processed_chunks`, `total_chunks`, coalesced to at most 20 events with the last always sent;
3. `result` — the same `DetectionResult` as `Detect`, last.

## Auth and health

| Method | Key required |
| --- | --- |
| `Detect`, `AnalyzeDocument` | `x-api-key` matching `API_KEY` |
| `grpc.health.v1.Health/Check`, `/Watch` | no |
| reflection (dev only) | no |

A missing or wrong key answers `UNAUTHENTICATED`. `Check` reports `SERVING` for `''` and `inference.v1.AIService`; unknown service names report `NOT_FOUND`.

## Errors

| Status | When | Detail |
| --- | --- | --- |
| `UNAUTHENTICATED` | bad or missing key | `Missing or invalid API key` |
| `INVALID_ARGUMENT` | blank/over-limit text, unknown model | reason, capped at 500 chars |
| `RESOURCE_EXHAUSTED` | model at capacity or service draining | reason, capped at 500 chars |
| `INTERNAL` | any other failure | `Internal Inference Error` |

## Codegen

`make proto` generates the Python stubs into `app/serving/generated/`. They are gitignored and regenerated in the Docker build, so a fresh checkout needs codegen before running outside a container.

## Try it

```sh
grpcurl -plaintext -H "x-api-key: $API_KEY" \
  -d '{"text":"Some text","model_id":"spark"}' \
  localhost:50051 inference.v1.AIService/Detect
```

## Next

- **[Request flow](../concepts/request-flow.md)** — how a call is served.
- **[Load rig](../../tests/load/README.md)** — the rejection matrix and stream checks.
