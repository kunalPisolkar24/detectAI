# Request Flows

## Detect (unary)

```mermaid
sequenceDiagram
    participant C as Client
    participant G as GRPCServer
    participant A as AuthInterceptor
    participant M as MonitoringInterceptor
    participant S as AIService
    participant D as DocumentAnalysisService
    participant B as BatchingProxy
    C->>G: Detect(text, model_id)
    G->>A: check x-api-key or Bearer HS256
    alt unauthenticated
        A-->>C: UNAUTHENTICATED
    else authenticated
        G->>M: bind trace_id/user_id
        M->>S: Detect
        S->>D: analyze(text, model_key)
        D->>D: validate(MAX_TEXT_CHARS 50000)
        D->>D: plan chunks(256/192, max_global 10000)
        D->>B: predict per chunk (inflight <=8, 30s timeout)
        B-->>D: float 0..1
        D->>D: aggregate weighted stride + highlight sweep
        D-->>S: DocumentScore
        S-->>C: PredictResponse(label, confidence 0..100, highlight_spans)
        M->>M: observe grpc_requests_total + latency
    end
```

* `model_id` normalized at `servicers.py:18` (truncate 64 → `lower().strip()` → default `spark`), unknown → `INVALID_ARGUMENT`.
* `DocumentAnalysisService:328` checks `health_snapshot()` before dispatch; `QUEUE_FULL`/`WORKER_UNAVAILABLE` → `ServiceOverloaded` → `RESOURCE_EXHAUSTED`.
* Per-chunk `asyncio.wait_for(..., timeout=30s)` in `ConcurrencyDispatcher`.

## AnalyzeDocument (server-streaming)

```mermaid
sequenceDiagram
    participant C as Client
    participant S as AIService
    participant D as DocumentAnalysisService
    participant B as BatchingProxy
    C->>S: AnalyzeDocument(text, model_id)
    S->>D: stream(text, model_key, is_active)
    D-->>S: DocumentStarted(total_chars, total_chunks)
    S-->>C: event started
    loop per chunk as_completed (semaphore 8)
        D->>B: predict(chunk.text)
        B-->>D: prob
        D-->>S: DocumentProgress(processed, total)
        S-->>C: event progress (monotonic)
        Note over C,D: check context.done() -> CANCELLED if disconnected
    end
    D->>D: aggregate final DocumentScore
    D-->>S: final Score
    S-->>C: event final PredictResponse
    S-->>C: stream end
```

Order enforced via `StreamingPresenter` (`servicers.py:94`):

```python
if presenter.is_started(event): yield build_started(...)
elif presenter.is_progress(event): yield build_progress(...)
elif presenter.is_final(event): yield build_final(...)
else: raise InferenceError
```

* `request_is_active=lambda: not context.done()` guards both `validate` and per-chunk `predict`; `asyncio.CancelledError` bubbles as `CANCELLED`.
* `progress` is strictly increasing (`1..total_chunks`), `total_chunks` matches `started`; client validates this in `load/lib/analyze.js:135`.

## Error branches

| Path | Code |
|---|---|
| Unknown `model_id` or bad offsets | `INVALID_ARGUMENT` |
| Queue full / worker dead / circuit open | `RESOURCE_EXHAUSTED` |
| Client disconnect | `CANCELLED` |
| Engine returned `NaN` or shape mismatch | `INTERNAL` (wrapped `InferenceError`) |
| Missing `started` or non-monotonic progress | Client-side `stream_check_failed` (k6) |

See `03-auth.md` for the `A` step and `07-health.md` for why `QUEUE_FULL` does not flip `SERVING`.
