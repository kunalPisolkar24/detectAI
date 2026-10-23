# Document Parser

FastAPI service for the document-parser API — specification in [specification/](specification/).
Basic build: health and readiness endpoints per the [HTTP contract](specification/http.md). The extract endpoint is a follow-up.

## Run

```sh
poetry install
poetry run uvicorn app.main:app --port 8000
```

## Verify

```sh
curl http://localhost:8000/api/v1/health
# {"status":"ok"}
curl http://localhost:8000/api/v1/ready
# {"status":"ready"}
```

## Docker

```sh
docker build -t detectai-document-parser .
docker run --rm -p 8000:8000 detectai-document-parser
```
