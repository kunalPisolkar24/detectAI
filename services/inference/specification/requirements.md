# Inference — Requirements

A stateless gRPC service that scores submitted text against pinned ONNX models and returns an AI-vs-human verdict, unary or streamed.

**Stack:** Python 3.14, Poetry, gRPC asyncio, ONNX Runtime, Hugging Face tokenizers, OpenTelemetry.
**Deployed target:** container on CPU or GPU; one model per process is a supported shape. See [Deployment target](#deployment-target).

Detailed designs: [spec index](README.md) · [design](design.md) · [API contract](api-contract.md) · [pipeline](pipeline.md) · [models](models.md) · [observability](observability.md). User docs: [docs/](../docs/README.md).

## Functional requirements

| ID | Requirement |
| --- | --- |
| FR-1 | Serve `Detect` (unary) and `AnalyzeDocument` (server-streaming) on `inference.v1.AIService`. |
| FR-2 | Gate every RPC except health and dev reflection with an `x-api-key` check. |
| FR-3 | Admit text within `MAX_TEXT_CHARS`; reject blank or over-limit input with `INVALID_ARGUMENT`. |
| FR-4 | Pull each enabled model at a pinned git SHA and verify the cache against that SHA before serving. |
| FR-5 | Load sessions and tokenizers offline; verify requested execution providers are effective. |
| FR-6 | Tokenize a document once, cut chunks at boundaries, and score them in batches. |
| FR-7 | Aggregate scored regions into one verdict with one highlight span per region. |
| FR-8 | Coalesce progress to at most 20 events, always sending the last. |
| FR-9 | Emit traces, metrics, and logs to New Relic when an OTLP endpoint is configured. |

## Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | Fail the boot before binding the port on any config, artifact, load, or warmup fault. |
| NFR-2 | Shed a request with `RESOURCE_EXHAUSTED` when its model is at capacity — never queue minutes of work. |
| NFR-3 | Keep the event loop free: preparation and scoring run on per-model thread pools. |
| NFR-4 | Drain in-flight work on SIGTERM/SIGINT within a 120-second grace period. |
| NFR-5 | Never expose an internal fault's detail to the client. |
| NFR-6 | Keep 95% test coverage over `app/`. |
| NFR-7 | Resolve all settings once at boot into one typed, validated `Settings`. |

## Authentication scheme

| Piece | Decision |
| --- | --- |
| Metadata key | `x-api-key`, compared with `hmac.compare_digest` |
| Open methods | health `Check`/`Watch`; reflection only on dev |
| Denied calls | `UNAUTHENTICATED`, marked failed on the live span |
| Bearer/JWT | none — the single consumer is the web BFF |

## Deployment target

| Runtime | Binding constraint | Verdict |
| --- | --- | --- |
| CPU container | fp16/fp32 forward passes are slow but deterministic | default; dev and CI |
| GPU container | needs an NVIDIA device and `onnxruntime-gpu` | supported via the `gpu` image and Compose overlay |

The container image runs stub codegen at build time and starts with `python -m app.main`. The same image is used locally and in CI.

## Numeric bounds

| Bound | Default | Failure behavior |
| --- | --- | --- |
| API key length | 16 chars | boot fails |
| Text length | 1,000,000 chars | `INVALID_ARGUMENT`, never truncated |
| Chunk window | 512 tokens | clamped to the model ceiling; below 64 fails the boot |
| Overlap | 0 tokens | must leave at least one content token |
| Batch width | 8 sequences | wider call refused |
| Engine pool width | 2 per model | also the per-model admission permit |
| Server concurrency | 8 RPCs | outer bound across models |
| Threshold | 0.5 | must lie in `[0, 1]` |

## Explicitly out of scope

- A batching proxy or queue shared across requests — batching is per-document slices today.
- Server-side persistence, caching, or job state.
- Model fine-tuning, artifact pruning, and garbage collection.
- Web-side adaptation to `inference.v1` — a separate service's slice.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Auth | one API key, no JWT | one consumer; fewer moving parts at the edge |
| Admission | reject, never truncate | truncation changes the document being scored |
| Saturation | shed at the model permit | the engine pool is the real capacity; a queue would hide the latency |
| Model identity | full pinned SHA, checked on disk | a stale volume must not silently serve an old build |
| Progress | at most 20 events | enough to show movement, cheap on long streams |
