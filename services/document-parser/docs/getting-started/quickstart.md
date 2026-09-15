# Quick Start

This guide will help you get the Document Parser service running quickly.

## Prerequisites

- Docker and Docker Compose
- Python 3.11+ (for local development)

## Running Locally

### Step 1: Start the Service

```bash
# Navigate to the document-parser service directory
cd services/document-parser

# Start the service
docker compose -f infra/compose.yml up -d --build
```

This starts:
- **document-parser** - The API server on port 8000

### Step 2: Verify It's Running

```bash
# Check if the service is healthy
docker compose -f infra/compose.yml ps

# Test the health endpoint
curl http://localhost:8000/api/v1/health
```

Expected response:
```json
{"status": "ok"}
```

### Step 3: Try It Out

#### Extract Text from a PDF

```bash
curl -F file=@sample.pdf http://localhost:8000/api/v1/extract
```

Response:
```json
{
  "text": "The extracted text content from your PDF...",
  "truncated": false,
  "filename": "sample.pdf",
  "content_type": "application/pdf",
  "text_length": 1234
}
```

#### Extract Text from a DOCX

```bash
curl -F file=@sample.docx http://localhost:8000/api/v1/extract
```

Response:
```json
{
  "text": "Content from your Word document...",
  "truncated": false,
  "filename": "sample.docx",
  "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text_length": 5678
}
```

#### Extract Text from a TXT

```bash
curl -F file=@sample.txt http://localhost:8000/api/v1/extract
```

Response:
```json
{
  "text": "Content from your text file...",
  "truncated": false,
  "filename": "sample.txt",
  "content_type": "text/plain",
  "text_length": 42
}
```

## What Just Happened?

1. You sent a file to the `/api/v1/extract` endpoint
2. The service **sniffed the MIME type** using `python-magic` (reads first 4096 bytes)
3. It checked the file **size** (must be under 10 MiB) and **format** (must be PDF, DOCX, or TXT)
4. It picked the right **extraction strategy** for the file type
5. The strategy extracted raw text from the document
6. The text was **cleaned** (normalized whitespace, removed control characters, fixed hyphenated breaks)
7. The cleaned text was returned to you

## Checking Readiness

The service also has a readiness endpoint that checks if the thread pool can handle new requests:

```bash
curl http://localhost:8000/api/v1/ready
```

Response when ready:
```json
{"status": "ready"}
```

Response when the thread pool is saturated:
```json
{"status": "not_ready"}
```

## Next Steps

- [Configuration](configuration.md) - Customize settings for your environment
- [Architecture](../concepts/architecture.md) - Understand how the service is built
- [API Reference](../components/api.md) - Complete API documentation

## Troubleshooting

### "Connection refused"

Make sure Docker is running and the services are started:
```bash
docker compose -f infra/compose.yml ps
```

### "Port already in use"

Another process is using port 8000. Either stop it or change the port in configuration:
```bash
# Check what's using the port
lsof -i :8000

# Or use a different port
PORT=8001 docker compose -f infra/compose.yml up -d
```

### "Service not responding"

Check the logs:
```bash
docker compose -f infra/compose.yml logs document-parser
```

### "415 Unsupported Media Type"

The file type is not supported. The service only accepts:
- PDF (`application/pdf`)
- DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
- TXT (`text/plain`)

### "413 Request Entity Too Large"

The file is too big. Maximum upload size is 10 MiB. Check the file size:
```bash
ls -lh sample.pdf
```

## Running Tests

```bash
# Unit tests (no Docker)
make test

# Integration tests (requires Docker)
make test-integration

# Load tests
make load-test
```

## Stopping the Service

```bash
# Stop all services
docker compose -f infra/compose.yml down

# Stop and remove volumes
docker compose -f infra/compose.yml down -v
```
