# Document Parser — Requirements

A stateless service that receives a document and returns its extracted text.

**Stack:** Python 3.14, FastAPI.
**Deployed target:** AWS Lambda behind API Gateway — the same container image the local runtime uses, fronted by the Lambda Web Adapter. See [Deployment target](#deployment-target).

Detailed designs: [spec index](README.md) · [HTTP contract](http.md) · [observability](observability.md) · [design](design.md)

## Functional requirements

| ID | Requirement |
|----|-------------|
| FR-1 | Accept a document upload over HTTP (multipart form) |
| FR-2 | Accept only the supported formats: PDF, DOCX, TXT. Reject anything else |
| FR-3 | Extract the text content of the document |
| FR-4 | Return the extracted text in the HTTP response |
| FR-5 | Return a clear error response when a request cannot be processed (wrong type, corrupt file, too large, processing failure) |
| FR-6 | Extraction requests authenticate with a shared API key. Missing or invalid credentials are rejected with 401. Probes (health, readiness) and the metrics endpoint stay unauthenticated |

### Authentication scheme

| Piece | Decision |
|-------|----------|
| Credential | Shared secret `API_KEY` — mandatory in every environment (dev, load rig, prod); in prod it is delivered via Secrets Manager, elsewhere via env |
| Validation at boot | Non-empty and at least 16 characters |
| Headers | `x-api-key` only — no `Authorization`/`Bearer` processing; the credential has one carrier and one comparison path |
| Comparison | Constant-time (`secrets.compare_digest`) over UTF-8 bytes |
| Failure | 401 with a generic message; missing and invalid credentials are indistinguishable in the response |
| Logging | Rejections are logged (NFR-8) at warning level without echoing the attempted key; the rejected-request counter lands with the metrics build |

## Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Stateless: no database, no persistent storage, no instance-to-instance state. The deployed target enforces this structurally — every instance resolves its own config at boot |
| NFR-2 | One request must not block another; slow or failing requests must not take the service down. On Lambda this is platform-provided: one request per instance, and scaling adds instances. The in-process worker pool survives as container-runtime behavior (local compose) behind a seam both runtimes share — one code path, exercised differently per environment |
| NFR-3 | Every request completes, succeeds, or fails within 10 seconds (configurable). A document that exceeds the budget is abandoned — the caller receives a timeout response. Notes: (a) the deadline applies to processing the document; oversized *input* is rejected by size limits, not the clock; (b) abandonment is soft: in a long-lived runtime the worker thread finishes naturally, with interior size caps guaranteeing quick termination — on Lambda the function timeout is the backstop; (c) the timeout stack must layer so the service's shaped 504 wins every race: API GW integration timeout > function timeout (12 s) > in-code budget (10 s) |
| NFR-4 | Upload size is bounded (3 MiB default, configurable) |
| NFR-5 | Observability is OTel-native — logs, traces, and metrics export via OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured; without it nothing is emitted. There is no pull/metrics endpoint. Metric names are a stable contract and change only with a dashboard/alert migration (see [observability.md](observability.md)) |
| NFR-6 | Health and readiness endpoints for probes and orchestrators; readiness sheds traffic when the service is saturated. Container-runtime behavior — Lambda has no probes; the platform owns availability and shedding. The endpoints stay in the contract for local parity |
| NFR-7 | Tests: unit and integration tests cover the service. The load/e2e rig update is deferred — see [Deferred](#deferred) |
| NFR-8 | Authentication failures are logged and counted as rejected requests |
| NFR-9 | SIGTERM/SIGINT stop new requests and drain in-flight work within 12 s (processing budget + slack), honouring the NFR-3 abandonment rules; the drain is logged. Container-runtime behavior — Lambda has no drain; the platform stops the instance |

## Deployment target

AWS Lambda behind API Gateway, synchronous proxy integration. The runtime survey that decided it — recorded so the choice survives its authors:

| Runtime | Binding constraint | Verdict |
|---------|--------------------|---------|
| Lambda behind API Gateway | 6 MB synchronous invocation payload (request **and** response; not increasable); binary bodies are base64-encoded into the invocation event (×4/3) | viable with a scaled-down upload bound |
| ALB → Lambda target | 1 MB request body and 1 MB response JSON — hard limits | not viable |
| App Runner | scale-to-zero cold start ≈ tens of seconds | not viable against the 10 s budget |
| ECS Fargate behind ALB | no payload ceiling — bodies stream to the container | viable; the fallback if bounds ever grow back |

Why the upload bound follows: 3 MiB body → 4.19 MB base64-encoded → ~2 MB headroom under the 6 MB invocation ceiling. A 10 MiB default cannot pass any synchronous Lambda invocation, and the presigned-S3 workaround contradicts the synchronous contract (out of scope below).

Operational notes:

- **Memory ≥ 1,769 MB (1 vCPU)** — Lambda allocates CPU proportional to memory; the pdfium worst-case figures (~1–3 s for 1,000 pages) assume a full core. 3 GB for comfort.
- **Function timeout 12 s** — the in-code budget (10 s) must win the race: a platform timeout is an opaque 502, never the spec-shaped 504.
- **Lambda Web Adapter over the existing image** — the FastAPI app, its config planes, and its tests stay unmodified; the same image serves local compose and Lambda.
- **API Gateway buffers the full request body** before invoking — the bounded read's "bulk never buffered" property holds inside the service only; accepted, because at 3 MiB the platform-side buffering is bounded.
- **Cold starts** (~1–3 s with the pdfium wheel) breach locally-tuned latency assertions on the deployed target; accepted for now — provisioned concurrency is the lever if the data demands it.
- The config plane resolves at boot; the prod Secrets Manager read adds ~100 ms to every cold start. Accepted.

## Numeric bounds

| Bound | Default | Failure behavior |
|-------|---------|------------------|
| Upload size | 3 MiB | Reject with a "too large" error before parsing |
| Processing budget | 10 s | Timeout response; document abandoned |
| PDF pages | 1,000 | Reject with a "too large" error before parsing |
| DOCX uncompressed size | 30 MiB | Reject with a "too large" error (zip-bomb guard) |
| Output text cap | 1,000,000 chars | Not an error — truncate once after cleaning; the response flags it with `truncated: true` |

All bounds are configurable at boot via environment variables with these defaults. Bounds fail closed: an unset or invalid value falls back to the safe default.

### Why the numbers moved (from the 10 MiB container world)

- **Upload 10 MiB → 3 MiB** — sized to the Lambda invocation ceiling: the base64-inflated event payload (3 MiB → 4.19 MB) plus event JSON overhead must stay under 6 MB with headroom. Env-configurable, so a future container deployment raises it without code changes.
- **DOCX uncompressed 100 MiB → 30 MiB** — the old 10 MiB / 100 MiB pairing accepted a 10× unfold ratio; the upload shrank, so the guard follows it to keep the same ratio. Real markup deflates at ~8–12×, so legitimate documents pass; bombs run 100×+ and die at the metadata read before a content byte is touched. (An earlier draft proposed 25 MiB — revised because the bound must clear the upload's *maximum* decompression ratio, not the XML a 1M-char document produces.)
- **PDF pages stays 1,000** — extraction cost scales with pages, not bytes: the page cap is the primary time-budget guard. At 3 MiB the two caps are near-coincident (~3 KB of compressed content per dense page), so the byte cap catches only the extreme tail.
- **Output cap and budget stay** — the 1M-char output cap keeps the worst-case response (~3–4 MB of UTF-8) inside the 6 MB invocation response limit; JSON responses are not base64-inflated.

## Explicitly out of scope

- Anything beyond text output of PDF / DOCX / TXT (no images, tables as data, or other formats; no OCR — scanned PDFs yield nothing and answer 422)
- Durable or async processing — synchronous request/response only
- Rate limiting or retries (handled by the caller / gateway)
- Explicit admission control (429/503 on full worker pool) — readiness shedding covers queue wait for now

## Caller-side knock-on (out of this build, tracked here)

- `apps/web` sends the API key with each extraction request (`FILE_EXTRACTOR_API_KEY` config + header on the extract call) — its own pull request
- `apps/web` uploads must respect the 3 MiB default — larger uploads now answer 413 named at the new limit; raising the bound is a deployment change, not a code change
- Load rig and e2e remote target env files carry the key — deferred with the rig

## Deferred

- **Load rig port (`slop/load` → `tests/load/`) and e2e harness updates** — deliberately postponed: load/stress/soak profiles are container-runtime concerns, and the deployed target adds platform latency (API Gateway, cold starts) that container-tuned assertions do not measure meaningfully. The cheap deployed-target checks (preflight/smoke/contract tiers) return with the e2e effort.
- **Observability build** (OTel pipeline + the revised metric inventory) — separate chunk, pending sign-off per [observability.md](observability.md).

## Open decisions (to be cleared before build starts)

- [x] Exact HTTP contract: endpoints, paths, request/response JSON shape, status codes — resolved in [http.md](http.md)
- [x] Metrics list — resolved in [observability.md](observability.md) (inventory revised for the Lambda target: pool/queue instruments dropped)
- [x] Output text cap: kept — 1,000,000 chars cap, truncation is not an error (`truncated: true`), enforced uniformly for all types; rationale in [http.md](http.md)
- [x] Text fidelity: cleaned/normalized text with format-aware header/footer suppression — contract in [cleaning.md](cleaning.md)
- [x] Load testing: k6 rig kept — **port deferred** with the deployed-target decision (container-runtime concern; to be updated later)
- [x] Deployment runtime: **AWS Lambda + API Gateway**, container image via Lambda Web Adapter — decided by the payload-limit survey in [Deployment target](#deployment-target); ALB→Lambda (1 MB) and App Runner (cold starts) eliminated
- [x] Upload bound default: **3 MiB** (was 10 MiB) — sized to the base64-inflated 6 MB invocation ceiling; env-configurable
- [x] DOCX uncompressed bound: **30 MiB** (was 100 MiB) — follows the upload bound to preserve the accepted 10× unfold ratio

Resolved: authentication is API-key based, always required, mirroring the inference service (see Authentication scheme above).
