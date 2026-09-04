# Configuration

## Env table

| Var | Default | Range | Notes |
|---|---|---|---|
| `MAX_UPLOAD_SIZE_BYTES` | `10485760` (10 MiB) | `>0` | `413` if exceeded |
| `MAX_TEXT_LENGTH` | `1000000` (1M chars) | `>0` | truncate output |
| `MAX_PDF_PAGES` | `1000` | `>0` | `422` if exceeded |
| `MAX_DOCX_UNCOMPRESSED_BYTES` | `104857600` (100 MB) | `>0` | zip bomb guard |
| `EXTRACTION_TIMEOUT_SECONDS` | `30.0` | `>0` | `504` on timeout |
| `READINESS_MAX_QUEUE_DEPTH` | `50` | `>0` | `queued >=50` → `503` |
| `WORKER_THREADS` | `4` | `>0` | fallback `cpu_count` |
| `PORT` | `8000` | `1..65535` | uvicorn |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(empty)* | `url` | if empty, tracing disabled |

## Validation

`pydantic-settings` `BaseSettings` ensures `>0` for all ints, `PORT` range.

## Compose

* `infra/compose.yml` — `document-parser:8000`, `healthcheck` via `curl /health`.
* `infra/compose.load.yml` — `parser + k6` for `make load-test`.
* `infra/compose.prod.yml` — `restart: always`.
