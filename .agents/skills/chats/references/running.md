# Running the service — local and docker

Everything here runs from `services/chats`; `make help` prints the raw index and `docs/reference/make.md` annotates every row.

## The local loop

```sh
make env             # infra/.env from the template — only if missing, never overwrites
make db-up cache-up  # MongoDB + Redis; a running instance is left untouched
make run             # sources infra/.env, repaints host.docker.internal → localhost, gin on :8090
```

Then edit `infra/.env` and set a real `API_KEY` (≥ 16 chars). `MONGO_URI` and `REDIS_ENDPOINT` in the template are container-shaped; `make run` repaints the host for you, so the same file drives host runs and containers.

Verify with the open probes:

```sh
curl http://localhost:8090/api/v1/health   # {"status":"ok"}
curl http://localhost:8090/api/v1/ready    # {"status":"ready"} — pings MongoDB
```

`ready` answers 503 `{"status":"database unreachable"}` if Mongo does not answer within 2 s.

## First RPC

Reflection is mounted, so `grpcurl` needs no schema file:

```sh
grpcurl -plaintext \
  -H "x-api-key: local-dev-api-key-16-chars" \
  -H "x-user-id: user-1" \
  -d '{"initial_message":"hello"}' \
  localhost:8090 chats.v1.ChatService/CreateChat
```

Or speak Connect over JSON on HTTP/1.1:

```sh
curl -X POST http://localhost:8090/chats.v1.ChatService/CreateChat \
  -H "Content-Type: application/json" \
  -H "Connect-Protocol-Version: 1" \
  -H "x-api-key: local-dev-api-key-16-chars" \
  -H "x-user-id: user-1" \
  -d '{"initial_message":"hello"}'
```

Both answer a `Chat` with a server-generated id and a title derived from the initial message. `x-user-id` is the owner every RPC speaks for; the api key is what makes it trustworthy. Reflection is HTTP/2-only — an HTTP/1.1 client gets `505`.

## Docker instead

```sh
make build
make up     # db-up, cache-up, then compose up detached
curl http://localhost:8090/api/v1/health
make down
```

The compose stack reads `infra/.env` wholesale, so the same config drives both ways of running. The container's built-in healthcheck runs a separate `/app/healthcheck` binary against `/api/v1/ready` every 30 s.

## The datastores

- `make db-up` / `db-down` start/stop local MongoDB (port from `infra/docker/mongo/.env`); a running instance is left untouched, and `down` keeps the data volume.
- `make cache-up` / `cache-down` do the same for Redis; the cache is ephemeral and its contents go with it.
- `make clean` takes down the service stack and both datastores, dropping the Mongo volume — for odd failures with nothing obviously changed.
- `make logs` / `make ps` for a running stack misbehaving or "is it even up?"

## The make-target index

| Target | What it does |
|--------|--------------|
| `make run` | sources `infra/.env`, repaints `host.docker.internal` → `localhost` for Mongo/Redis/AWS, runs the API |
| `make env` | copies `infra/.env.example` → `infra/.env` **if missing** |
| `make tidy` / `make vet` | `go mod tidy` / `go vet ./...` |
| `make build` / `up` / `down` | the docker lifecycle (image `detectai-chats`) |
| `make db-up` / `db-down` | local MongoDB |
| `make cache-up` / `cache-down` | local Redis |
| `make logs` / `make ps` / `make clean` | compose diagnostics and full cleanup |
| `make test` / `test-unit` / `test-integration` | the test suites — [references/testing.md](testing.md) |
| `make coverage` / `coverage-unit` / `coverage-html` / `coverage-check` | coverage of `./internal/...`, 95% gate |
| `make load-env` / `load-test` / `load-e2e` / `load-down` | the k6 rig — [references/testing.md](testing.md) |
| `make secrets-*` | the tfctl-driven secrets plane — [references/config.md](config.md) |

## Deployment shape

No Lambda here — the deployed artifact is the same distroless container image local compose uses (static Go binary, nonroot), listening on `:8090` with HTTP/1.1 and unencrypted HTTP/2 enabled. H2C is why the load rig can drive native gRPC with reflection and the healthcheck can drive HTTP/1.1 on the same port. On SIGTERM the server stops accepting and drains in-flight RPCs within `DRAIN_TIMEOUT` (default 10 s); telemetry drains first (15 s), then Mongo and Redis (5 s), with teardown errors logged only. Probes and reflection stay in the contract; there is no platform front door to redefine them.

[Back to the briefing](../SKILL.md)
