# Document Parser — Requirements

A stateless service that receives a document and returns its extracted text.

**Stack:** Python 3.11, FastAPI.

Detailed designs: [spec index](README.md) · [HTTP contract](http.md) · [observability](observability.md)

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
| Headers | `x-api-key` or `Authorization: Bearer` (both accepted, matching the inference service) |
| Comparison | Constant-time (`secrets.compare_digest`) |
| Failure | 401 with a generic message; missing and invalid credentials are indistinguishable in the response |

## Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Stateless: no database, no persistent storage, no instance-to-instance state |
| NFR-2 | One request must not block another; slow or failing requests must not take the service down |
| NFR-3 | Every request completes, succeeds, or fails within 10 seconds (configurable). A document that exceeds the budget is abandoned — the caller receives a timeout response. Notes: (a) the deadline applies to processing the document; oversized *input* is rejected by size limits, not the clock; (b) abandonment is soft: the worker thread may keep running until the bounded-size work finishes naturally; interior size caps guarantee it terminates quickly |
| NFR-4 | Upload size is bounded (10 MiB default, configurable) |
| NFR-5 | Observability is OTel-native — logs, traces, and metrics export via OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured; without it nothing is emitted. There is no pull/metrics endpoint. Metric names are a stable contract and change only with a dashboard/alert migration (see [observability.md](observability.md)) |
| NFR-6 | Health and readiness endpoints for probes and orchestrators; readiness sheds traffic when the service is saturated |
| NFR-7 | Tests: unit, integration, and load tests cover the service |
| NFR-8 | Authentication failures are logged and counted as rejected requests |

## Numeric bounds

| Bound | Default | Failure behavior |
|-------|---------|------------------|
| Upload size | 10 MiB | Reject with a "too large" error before parsing |
| Processing budget | 10 s | Timeout response; document abandoned |
| PDF pages | 1,000 | Reject with a "too large" error before parsing |
| DOCX uncompressed size | 100 MiB | Reject with a "too large" error (zip-bomb guard) |
| Output text cap | 1,000,000 chars | Not an error — truncate once after cleaning; the response flags it with `truncated: true` |

All bounds are configurable at boot via environment variables with these defaults. Bounds fail closed: an unset or invalid value falls back to the safe default.

## Explicitly out of scope

- Anything beyond text output of PDF / DOCX / TXT (no images, tables as data, or other formats)
- Durable or async processing — synchronous request/response only
- Rate limiting or retries (handled by the caller / gateway)
- Explicit admission control (429/503 on full worker pool) — readiness shedding covers queue wait for now

## Caller-side knock-on (out of this build, tracked here)

- `apps/web` sends the API key with each extraction request (`FILE_EXTRACTOR_API_KEY` config + header on the extract call) — its own pull request
- Load rig and e2e remote target env files carry the key

## Open decisions (to be cleared before build starts)

- [x] Exact HTTP contract: endpoints, paths, request/response JSON shape, status codes — resolved in [http.md](http.md)
- [x] Metrics list — resolved in [observability.md](observability.md)
- [x] Output text cap: kept — 1,000,000 chars cap, truncation is not an error (`truncated: true`), enforced uniformly for all types; rationale in [http.md](http.md)
- [ ] Text fidelity: plain text returned raw, or cleaned/normalized text
- [ ] Load testing: keep the existing k6 rig or defer

Resolved: authentication is API-key based, always required, mirroring the inference service (see Authentication scheme above).
