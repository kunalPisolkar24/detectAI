# API Reference

This document explains how to use the Inference service API. The API uses **gRPC** (a fast, efficient way for applications to communicate).

## Getting Started

### Prerequisites

To use the API, you need:

- A running Inference service (see [Configuration](../getting-started/configuration.md))
- A gRPC client such as [`grpcurl`](https://github.com/fullstorydev/grpcurl) for the examples below
- Credentials: every RPC except the health check needs an `x-api-key` header or a `Bearer` JWT (see [Authentication](auth.md))

```bash
export API_KEY=dev-secret-key-16chars-at-least   # must match the service's API_KEY
```

### Base URL

The API runs on port `50051` by default:

```
localhost:50051
```

## Available Methods

### Detect (Unary RPC)

**What it does:** Analyzes a short text and returns whether it's AI-generated.

**Request:**

```bash
grpcurl -plaintext -H "x-api-key: $API_KEY" -d '{
  "text": "The quick brown fox jumps over the lazy dog.",
  "model_id": "spark"
}' localhost:50051 aidetection.AIService/Detect
```

**Response:**

```json
{
  "modelName": "Spark",
  "label": "Human",
  "isAiGenerated": false,
  "confidenceScore": 85.2,
  "humanConfidence": 85.2,
  "aiConfidence": 14.8,
  "highlightSpans": []
}
```

**Request fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | Text to analyze (max 50,000 characters) |
| `model_id` | string | No | Model to use: `spark` (default) or `flare` |

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `modelName` | string | Which model was used (`Spark` or `Flare`) |
| `label` | string | `AI` or `Human` |
| `isAiGenerated` | bool | `true` if AI-generated |
| `confidenceScore` | float | Overall confidence (0-100) |
| `humanConfidence` | float | Confidence it's human-written (0-100) |
| `aiConfidence` | float | Confidence it's AI-generated (0-100) |
| `highlightSpans` | list | Spans of AI-generated text: `charStart`, `charEnd`, `aiConfidence` (all JSON names use lowerCamelCase, per proto3 JSON mapping) |

All three confidence fields are **percentages rounded to one decimal**, not 0-1 probabilities. `confidenceScore` mirrors the winning side: `aiConfidence` when `isAiGenerated` is true, otherwise `humanConfidence`.

### AnalyzeDocument (Server-Streaming RPC)

**What it does:** Analyzes a longer document with real-time progress updates.

**Request:**

```bash
grpcurl -plaintext -H "x-api-key: $API_KEY" -d '{
  "text": "Your long document text here...",
  "model_id": "flare"
}' localhost:50051 aidetection.AIService/AnalyzeDocument
```

**Response stream:**

1. **Started event:**
```json
{
  "started": {
    "totalChars": 1234,
    "totalChunks": 5
  }
}
```

2. **Progress events (monotonically increasing):**
```json
{
  "progress": {
    "processedChunks": 1,
    "totalChunks": 5
  }
}
```

Progress events are **coalesced**: the server emits one only after at least `totalChunks / 20` chunks have completed since the previous one (the last chunk always emits). Small documents may see one event per chunk; a 500-chunk document sees at most ~20. Never assume one progress event per chunk.

3. **Final event:**
```json
{
  "final": {
    "modelName": "Flare",
    "label": "AI",
    "isAiGenerated": true,
    "confidenceScore": 92.5,
    "humanConfidence": 7.5,
    "aiConfidence": 92.5,
    "highlightSpans": [
      {
        "charStart": 0,
        "charEnd": 1234,
        "aiConfidence": 92.5
      }
    ]
  }
}
```

### Health Check

**What it does:** Checks if the service is healthy and ready to accept requests.

**Request:**

```bash
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
```

**Response:**

```
{
  "status": "SERVING"
}
```

## Available Models

| Model | Best For | Speed | Accuracy |
|-------|----------|-------|----------|
| `spark` | Short texts, quick analysis | Fast | Good |
| `flare` | Long documents, detailed analysis | Slower | Better |

**Model ID normalization:**
- Case-insensitive (`Spark` = `spark` = `SPARK`)
- Truncated to 64 characters
- Defaults to `spark` if empty or missing
- Unknown models return `INVALID_ARGUMENT`

## Status Codes

| Code | Meaning | How to Fix |
|------|---------|------------|
| `OK` | Success | - |
| `INVALID_ARGUMENT` | Bad input | Check your request |
| `RESOURCE_EXHAUSTED` | Service overloaded | Try again later |
| `UNAUTHENTICATED` | Not authenticated | Check your API key or JWT |
| `CANCELLED` | Client disconnected | Reconnect and retry |
| `INTERNAL` | Server error | Try again later |

## Validation Rules

| Rule | Value | Error |
|------|-------|-------|
| Text cannot be empty | `text` required | `INVALID_ARGUMENT` |
| Text max length | 50,000 characters | `INVALID_ARGUMENT` |
| Text max tokens | 10,000 tokens | `INVALID_ARGUMENT` |
| Model ID max length | 64 characters | Truncated |
| Log values truncated | 500 characters | Prevents injection |

## Common Examples

### Complete Analysis Flow

```bash
# 1. Check health (no auth needed)
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check

# 2. Detect with Spark (fast)
grpcurl -plaintext -H "x-api-key: $API_KEY" -d '{
  "text": "This is a test message.",
  "model_id": "spark"
}' localhost:50051 aidetection.AIService/Detect

# 3. Analyze with Flare (detailed)
grpcurl -plaintext -H "x-api-key: $API_KEY" -d '{
  "text": "Your longer document here...",
  "model_id": "flare"
}' localhost:50051 aidetection.AIService/AnalyzeDocument
```

### Using API Key Authentication

```bash
# API key (internal service)
grpcurl -H "x-api-key: $API_KEY" \
  -d '{"text": "Hello world"}' \
  localhost:50051 aidetection.AIService/Detect
```

`AI_SERVICE_API_KEY` (the name used elsewhere in the monorepo) holds the same value as the service's `API_KEY` — either name works as long as it matches.

### Using JWT Authentication

```bash
# Generate a JWT token (HS256, signed with the service API key)
TOKEN=$(python load/scripts/generate_token.py --secret $API_KEY)

# Use the token
grpcurl -H "authorization: Bearer $TOKEN" \
  -d '{"text": "Hello world"}' \
  localhost:50051 aidetection.AIService/Detect
```

## Tips

1. **Use `spark` for quick analysis** - It's faster and works well for short texts
2. **Use `flare` for detailed analysis** - It's more accurate for longer documents
3. **Handle errors gracefully** - Check error codes in your code
4. **Use streaming for long documents** - Users see progress in real-time
5. **Monitor health** - Use the health endpoint to check service status

## Related Documentation

- [Authentication](auth.md) - How to authenticate requests
- [Configuration](../getting-started/configuration.md) - API settings
- [Architecture](../concepts/architecture.md) - How the API fits in the system
