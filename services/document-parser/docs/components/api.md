# API Reference

This document explains how to use the Document Parser service API. The API uses **HTTP REST** with JSON responses.

## Getting Started

### Prerequisites

To use the API, you need:

- A running Document Parser service (see [Quick Start](../getting-started/quickstart.md))
- A tool like `curl` for making HTTP requests

### Base URL

The API runs on port `8000` by default:

```
http://localhost:8000
```

## Available Endpoints

### Extract Text from a File

**What it does:** Extracts clean text from a PDF, DOCX, or TXT file.

**Request:**

```bash
curl -F file=@sample.pdf http://localhost:8000/api/v1/extract
```

**Response (200 OK):**

```json
{
  "text": "The extracted and cleaned text from your document...",
  "truncated": false,
  "filename": "sample.pdf",
  "content_type": "application/pdf",
  "text_length": 1234
}
```

**All response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | The extracted and cleaned text |
| `truncated` | boolean | `true` if text was cut off at `MAX_TEXT_LENGTH` (1M chars) |
| `filename` | string | Original filename from the upload |
| `content_type` | string | Detected MIME type of the file |
| `text_length` | integer | Number of characters in the returned text |

**Example with DOCX:**

```bash
curl -F file=@document.docx http://localhost:8000/api/v1/extract
```

```json
{
  "text": "Content from your Word document...",
  "truncated": false,
  "filename": "document.docx",
  "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text_length": 5678
}
```

**Example with TXT:**

```bash
curl -F file=@notes.txt http://localhost:8000/api/v1/extract
```

```json
{
  "text": "Content from your text file...",
  "truncated": false,
  "filename": "notes.txt",
  "content_type": "text/plain",
  "text_length": 42
}
```

### Health Check

**What it does:** Checks if the service is running and the thread pool is healthy.

**Request:**

```bash
curl http://localhost:8000/api/v1/health
```

**Response (200 OK):**

```json
{"status": "ok"}
```

**Response (503 Service Unavailable):**

```json
{"status": "unavailable"}
```

### Readiness Check

**What it does:** Checks if the service can handle new requests (thread pool not saturated).

**Request:**

```bash
curl http://localhost:8000/api/v1/ready
```

**Response (200 OK):**

```json
{"status": "ready"}
```

**Response (503 Service Unavailable):**

```json
{"status": "not_ready"}
```

### Prometheus Metrics

**What it does:** Returns metrics in Prometheus format for monitoring.

**Request:**

```bash
curl http://localhost:8000/api/v1/metrics
```

**Response:** Prometheus text format (not JSON).

## Error Codes

When something goes wrong, the API returns these error codes:

| Code | Meaning | How to Fix |
|------|---------|------------|
| `200` | Success | - |
| `413` | File too large | Upload a file smaller than 10 MiB |
| `415` | Unsupported format | Use PDF, DOCX, or TXT |
| `422` | Document too large or corrupt | PDF: reduce pages below 1000. DOCX: reduce size below 100 MB uncompressed |
| `503` | Service unavailable | Wait and retry (pool saturated or unhealthy) |
| `504` | Extraction timeout | Try a smaller file or increase `EXTRACTION_TIMEOUT_SECONDS` |

## Complete Extraction Flow

Here's a full example of extracting text and checking the result:

```bash
# 1. Extract text from a PDF
RESPONSE=$(curl -s -F file=@sample.pdf http://localhost:8000/api/v1/extract)

# 2. Check if truncated
TRUNCATED=$(echo $RESPONSE | jq -r .truncated)
if [ "$TRUNCATED" = "true" ]; then
  echo "Warning: Text was truncated (file too large)"
fi

# 3. Get the text length
LENGTH=$(echo $RESPONSE | jq -r .text_length)
echo "Extracted $LENGTH characters"

# 4. Get just the text
echo $RESPONSE | jq -r .text
```

## Tips

1. **Check file size first** -- Files must be under 10 MiB
2. **Verify format** -- Only PDF, DOCX, and TXT are supported
3. **Handle truncation** -- Check `truncated` field in response
4. **Use health checks** -- Check `/health` before submitting large batches
5. **Monitor with metrics** -- Use `/metrics` for Prometheus monitoring

## Related Documentation

- [Validation](validation.md) - Input validation rules
- [Health Checks](health.md) - Health and readiness probes
- [Configuration](../getting-started/configuration.md) - API settings
- [Architecture](../concepts/architecture.md) - How the API fits in the system
