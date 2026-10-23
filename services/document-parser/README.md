# Document Parser

FastAPI service for the document-parser API — specification in [specification/](specification/).
Basic build: health and readiness endpoints per the [HTTP contract](specification/http.md). The extract endpoint is a follow-up.

## Run

Run `make help` for the full command index.

```sh
make install
make env    # creates infra/.env from infra/.env.example
make run
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
make build
PORT=8000 make up
```
