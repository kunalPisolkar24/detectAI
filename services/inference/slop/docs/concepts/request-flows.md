# Request Flows

This document explains how user requests are processed by the Inference service. We'll look at each main operation and see what happens step by step.

## Detect (Unary RPC)

When a user sends a short text for analysis, it's processed in a single request-response cycle.

```mermaid
sequenceDiagram
    participant C as Client
    participant G as GRPCServer
    participant M as MonitoringInterceptor
    participant A as AuthInterceptor
    participant S as AIService
    participant D as DocumentAnalysisService
    participant B as BatchingProxy
    C->>G: Detect(text, model_id)
    G->>M: bind trace_id, wrap handler for metrics
    M->>A: check x-api-key or Bearer HS256
    alt unauthenticated
        A-->>C: UNAUTHENTICATED
    else authenticated
        A->>S: Detect
        S->>D: analyze(text, model_key)
        D->>D: validate(MAX_TEXT_CHARS 50000)
        D->>D: plan chunks(256/192, max_global 10000)
        D->>B: predict per chunk (worker pool 8, 30s timeout)
        B-->>D: float 0..1
        D->>D: aggregate weighted stride + highlight sweep
        D-->>S: DocumentScore
        S-->>C: PredictResponse(label, confidence 0..100, highlight_spans)
        M->>M: observe grpc_requests_total + latency
    end
```

**What happens:**

1. Client sends a `Detect` request with text and model ID
2. `MonitoringInterceptor` runs first: it binds a trace ID and wraps the handler so every outcome — including auth failures — is counted
3. `AuthInterceptor` checks the API key or JWT token
4. `DocumentAnalysisService.analyze()` is called
5. Text is validated (not empty, within 50,000 character limit)
6. Text is split into chunks (256 tokens each, 192 token step → 64-token overlap)
7. Chunks run through a fixed worker pool (max 8 in flight, 30s timeout per chunk)
8. Results are aggregated into a weighted score
9. Response is returned with label (`AI` or `Human`), confidence score, and highlight spans

**Why it's fast:** The batching proxy collects multiple chunks and runs them in parallel.

## AnalyzeDocument (Server-Streaming RPC)

When a user sends a long document, they get real-time progress updates.

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
    loop per chunk as_completed (worker pool 8)
        D->>B: predict(chunk.text)
        B-->>D: prob
        D-->>S: DocumentProgress(processed, total)
        S-->>S: coalesce: send only every total/20 chunks
        S-->>C: event progress (monotonic)
        Note over C,D: check context.done() -> CANCELLED if disconnected
    end
    D->>D: aggregate final DocumentScore
    D-->>S: final Score
    S-->>C: event final PredictResponse
    S-->>C: stream end
```

**What happens:**

1. Client sends an `AnalyzeDocument` request
2. Service validates the text and plans chunks
3. First event: `started` with `total_chars` and `total_chunks`
4. For each chunk (as it completes):
   - Chunk is predicted
   - `progress` events are **coalesced**: the servicer sends one only when at least `total_chunks / 20` chunks have passed since the last one (always including the final chunk), so a large document produces at most ~20 progress events instead of one per chunk
   - Progress is strictly increasing (monotonic)
5. Final event: `PredictResponse` with complete analysis
6. Stream ends

**Why streaming?** Users see progress in real-time instead of waiting for the entire analysis to complete. The same interceptors as `Detect` apply — auth runs before the stream starts.

## Error Handling

When something goes wrong, the service returns clear error messages:

| Path | Code | Meaning |
|------|------|---------|
| Unknown `model_id` or bad text | `INVALID_ARGUMENT` | Bad input from client |
| Engine returned a non-numeric or out-of-range probability | `INVALID_ARGUMENT` | Model output failed validation |
| Queue full / worker unavailable / shutting down | `RESOURCE_EXHAUSTED` | Service overloaded, try later |
| Client disconnect | `CANCELLED` | Client stopped listening |
| Unexpected engine or server failure | `INTERNAL` | Something broke on the server (message is always the generic `Internal Inference Error`) |

**Important:** `RESOURCE_EXHAUSTED` does NOT flip the health status to `NOT_SERVING`. The service keeps accepting traffic but sheds load quickly.

## Summary

| Operation | How It Works | Speed |
|-----------|--------------|-------|
| Detect | Single request-response | Fast (depends on text length) |
| AnalyzeDocument | Stream with progress updates | Shows progress in real-time |

## Next Steps

- [Chunking](chunking.md) - How text is split into chunks
- [Batching](batching.md) - How chunks are batched for efficiency
- [Authentication](../components/auth.md) - How requests are authenticated
- [API Reference](../components/api.md) - Complete API documentation
