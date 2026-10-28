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

## Load + e2e

One `infra/.env.load` (copy `infra/.env.load.example`) drives both commands;
the tests only send traffic and assert responses. See
[load/README.md](load/README.md) for the scenario set.

```sh
make load-env             # creates infra/.env.load from the example if missing
make load-test            # container rig: parser + k6 on an isolated network
make load-e2e             # k6 only, against whatever infra/.env.load's API_URL names
                          # (make run, a docker stack, a Lambda URL, prod)
make load-down
```
