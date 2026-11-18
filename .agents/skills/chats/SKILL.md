---
name: chats
description: DetectAI's chats — the Go/ConnectRPC chat store over Gin, MongoDB, and Redis (services/chats). Use when working anywhere in that tree — the Connect handler and interceptors, the service use cases, the MongoDB repository or Redis cache plane, config planes or secrets tooling, the OTel facade, unit/integration tests or the k6 load rig, compose, or the proto contract — running, configuring, extending, or debugging the service.
---

# Chats — the ConnectRPC chat store

A synchronous chat store: eight ConnectRPCs over Gin, MongoDB as the source of truth, Redis as a read-through overlay. There is no worker pool, no queue, and no streaming RPC — the BFF streams inference itself and calls this service for CRUD. Two headers on every call (`x-api-key` for the caller, `x-user-id` for the owner), one request path: telemetry → timeout → auth → rate limit → handler → validate → cache read-through → Mongo write → invalidate → answer. Current shape: eight RPCs, dev/prod config planes, the OTel facade with nine instruments, unit + integration suites, and a two-scenario k6 rig that speaks both Connect-over-JSON and native gRPC over H2C.

## Map

```text
services/chats/
├── cmd/
│   ├── api/main.go           the boot: flick → config → obs → Mongo → repo → cache → service → serve
│   └── healthcheck/main.go   container probe against /api/v1/ready
├── internal/
│   ├── server/               serve until SIGTERM, drain in-flight requests
│   ├── router/               gin engine: probes, grpchealth, reflection, the Connect handler
│   ├── handlers/             the Connect face: four interceptors, 8 RPCs, mapping, error codes
│   ├── services/             use cases, validation, cache-aside orchestration
│   ├── repository/           MongoDB access, keyset cursor, index creation
│   ├── cache/                Redis client, entries, key inventory, limiter, null builds
│   ├── db/                   MongoDB connection + retry
│   ├── config/               typed Config, dev/prod planes, fail-fast
│   ├── models/               shared vocabulary: shapes, enums, errors, limits, cursor
│   └── observability/        the OTel facade: the null build or push to New Relic
├── proto/                    chat_service.proto + generated Go stubs
├── infra/                    .env planes, compose files, the k6 load env
├── secrets.toml              the tfctl declaration — secrets vs SSM, committed
├── mk/ + Makefile            make targets: local / docker / tests / load / secrets
├── tests/                    unit + integration + load (k6) — a hard tree boundary
├── specification/            design history for maintainers — history, not truth
└── docs/                     the deep documentation tree
```

The layering is inward-facing: `handlers` owns statuses, `services` owns the use cases, `repository`/`cache` own the two stores, and `models` is the vocabulary everyone shares. The handler faces the `Service` and `Telemetry` interfaces, never a driver or OTel type.

## Run it

```sh
cd services/chats
make env                 # infra/.env from the template — only if missing, never overwrites
make db-up cache-up      # local MongoDB + Redis; a running instance is left untouched
make run                 # gin on :8090, H2C + HTTP/1.1
curl http://localhost:8090/api/v1/health
```

Edit `infra/.env` and set a real `API_KEY` (≥ 16 chars). `make run` repaints `host.docker.internal` to `localhost` for the host. Docker: `make build && make up`. Probes, the first RPC, and the make-target tour: [references/running.md](references/running.md)

## Change the store without breaking it

- Interceptor order **is** the contract: telemetry (outermost) → timeout 8 s → auth → rate limit → handler. Telemetry counts refusals from the inner two; an unauthenticated call never reaches a counter.
- Identity comes from headers, never the body: `x-api-key` is constant-time compared, `x-user-id` is trusted only because the key authenticated its holder. Missing and wrong keys collapse into one `unauthenticated`.
- Ownership is checked at the query, not after the fetch: any `chat_id` not owned answers `not_found` — one code for "missing" and "not yours". A cached chat rechecks the owner on a hit.
- Redis is an **overlay**, never the source of truth. Writes go to Mongo first, then `DEL` the affected keys best-effort; a fault is logged and absorbed because the TTL bounds staleness. Reads degrade to Mongo; the limiter fails open. Redis down at boot installs null builds and the service still serves.
- Writes are idempotent: duplicate user-message id = replay, analysis re-sends replay or advance the state machine, re-delete succeeds. Terminal analysis states accept only an identical replay — anything else is `failed_precondition`.
- Pagination is keyset on `(created_at, _id)` with an opaque, chat-bound cursor. Cursor pages bypass the cache; the head page is served from `chats:chat:{id}:head`.
- The 8 s RPC budget sits above the driver's 5 s server-selection timeout so an unreachable Mongo answers `unavailable` before the deadline.
- Metric names are a contract — dashboards query them by name, so a rename is a migration, not an edit.
- Finish every change with `make test` (unit + integration in one go).

## Config and secrets rules

- Config is resolved **once at boot** and frozen; changing a knob means a restart, never a mid-flight edit.
- The split that matters: numeric bounds fail closed (an unreadable value falls back to the safe default), while credentials, store URIs, the port, and the OTel gate fail the boot — a half-configured instance never serves.
- Four credentials: `API_KEY`, `MONGO_URI`, `REDIS_AUTH_TOKEN`, `NEW_RELIC_LICENSE_KEY`. The first three are required; the license key is demanded only when the OTel endpoint is set. `rediss://` requires an AUTH token of ≥ 16 chars. Rejections never echo the attempted key.
- Dev plane = process env over `infra/.env`. Prod plane = one Secrets Manager blob (`detectai/chats/secrets`) + one SSM prefix read (`/detectai/chats/`). Secrets and SSM config are disjoint planes — a key seeded into both is an operator error the boot refuses to paper over.
- Reflection is unauthenticated and always mounted — it serves schema only, never data. The RPCs keep their own guard. Probes stay open.

## Infra and testing — the short tours

- **AWS slice:** `make env` → `make secrets-check` (always first) → `make secrets-plan` → `make secrets-apply` → `make secrets-verify` — fingerprints only, exit 1 on drift; `make secrets-auto-apply` is the one-shot (validate → plan → apply → verify). Every verb takes `PLANE=floci|aws` (default floci; auto-approved on the emulator plane, interactive on real AWS) and `DRY_RUN=1` previews any verb. Real-AWS verbs ride the MFA-gated seeder role with the 12-hour session cached in `tools/tfctl/.session-cache/` — a plan → apply stretch prompts once; the whole plane is driven by `tools/tfctl`, and there is no hand-rolled terraform here.
  Verbs, carrier/MFA behavior, rotation, gotchas: [references/config.md](references/config.md)
- **Tests:** `make test` is the default gate; `make test-unit` for logic-only iteration, `make test-integration` for the container-backed tree and the prod config plane (skips, not fails, without Docker or floci); `make coverage-check` enforces 95%. The k6 rig is `make load-env` → `load-test` / `load-e2e`, with `PROTOCOL=http|grpc`. What each really runs: [references/testing.md](references/testing.md)

## Observability

The whole telemetry build is switched by one env var, `OTEL_EXPORTER_OTLP_ENDPOINT`: unset boots `NullTelemetry` (legitimate, zero SDK objects, one code path everywhere); set boots the full pipeline and additionally requires `NEW_RELIC_LICENSE_KEY` (≥ 16 chars) or the boot fails. Traces, metrics, and logs push over OTLP/HTTP direct to New Relic EU — no collector hop. Metric names: `chats_rpc_requests_total`, `chats_rpc_errors_total`, `chats_rpc_duration_seconds`, `chats_cache_operations_total`, `chats_cache_operation_duration_seconds`, `chats_datastore_operations_total`, `chats_datastore_operation_duration_seconds`, `chats_rate_limit_refusals_total`, `chats_validation_rejections_total`. The HTTP route span rides otelgin; the procedure span comes from the Connect interceptor.

Boards, alerts, and the push pipeline they rely on belong to the `observability` skill — not this one.

## Guardrails

- Never commit real `infra/.env` or `infra/.env.load` values — only the committed templates (`.env.example`, `.env.load.example`) enter git.
- No worker pool, no executor, no queue, no streaming RPC — the request path is strictly synchronous; concurrency lives outside the process (container replicas). The BFF streams inference directly.
- No second credential carrier (`Authorization: Bearer` twins) — one secret, one header, plus the asserted user header it authenticates.
- Redis never fails an RPC: reads degrade, invalidations are absorbed, the limiter fails open. Do not change a cache fault into a 5xx.
- Secrets verbs go through the make targets (tfctl) — no ad-hoc terraform against the plane.
- Do not cross service boundaries or share code between services (monorepo rule).
- Write documentation under `docs/` in its established style; `specification/` records how decisions were made — cite it, don't extend it.

## When you need depth

| Need | Go to |
|------|-------|
| Components, boot and shutdown, runtime model | `services/chats/docs/concepts/architecture.md` |
| Interceptors, auth, validation, cache read-through | `services/chats/docs/concepts/request-flow.md` |
| Cache keys, TTLs, invalidation, failure semantics | `services/chats/docs/concepts/cache.md` |
| Collections, indexes, keyset cursor, analysis state machine | `services/chats/docs/concepts/data-model.md` |
| The OTel gate, nine instruments, where records are taken | `services/chats/docs/concepts/observability.md` |
| Every env key and fail-fast rule | `services/chats/docs/getting-started/configuration.md` |
| Eight RPCs, codes, pagination, rate limits, reflection | `services/chats/docs/reference/rpc-api.md` |
| What each test suite runs | [references/testing.md](references/testing.md) |
| Local + docker operations, first RPC | [references/running.md](references/running.md) |
| The config planes, secrets verbs, carrier/MFA | [references/config.md](references/config.md) |
| The engine behind the secrets verbs | the `tfctl` skill |
| Dashboards and alerts | the `observability` skill |
| Every make target, annotated | `services/chats/docs/reference/make.md` |
| The credential's runtime story | `services/chats/docs/guides/secrets.md` |
