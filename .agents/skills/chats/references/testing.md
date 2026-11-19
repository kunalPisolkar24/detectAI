# Testing the service

Three layers, each answering a different question: **unit tests hold pure logic with fakes; integration tests drive real datastores; the load rig sends real traffic** — three trees with a hard boundary between them.

| Question | Layer | Command |
|----------|-------|---------|
| Does this function or codec do the right math? | unit | `make test-unit` |
| Does the Mongo/Redis path really work? | integration | `make test-integration` |
| Does the prod config plane read what seeding writes? | integration | `make test-integration` |
| How does the service behave under traffic? | load | `make load-test` / `make load-e2e` |

`make test` runs the whole Go suite module-wide. Green means exit 0; `go test` and k6 alike propagate failures to the shell.

## Unit — fast and faked

One folder per component, black-box over the exported API:

| Folder | Covers |
|--------|--------|
| `tests/unit/models/` | the cursor codec — strict decode, foreign chat id |
| `tests/unit/config/` | dotenv grammar, env-over-file, both planes through fakes, fail-fast and fail-closed |
| `tests/unit/db/` | connect + retry timing |
| `tests/unit/cache/` | key builders, TTLs, limiter decision, null builds |
| `tests/unit/handlers/` | the status matrix, auth, rate-limit scopes, refusal metadata, telemetry |
| `tests/unit/router/` | mounting, interceptor order, probe behavior |
| `tests/unit/services/` | use cases, validation, degraded cache |
| `tests/unit/observability/` | null vs wired boot, resource identity, instruments |

## Integration — real containers

`tests/integration/support` starts shared `mongo:8.0` and `redis:8-alpine` testcontainers (2 min start budget), skips when Docker is unreachable, and offers per-test fixtures whose `Stop()` kills the container for the real outage cases — Mongo outage and degraded cache. `make test-integration` is serialized (`-p 1`) so one container set is alive at a time. The prod config plane is exercised against floci (`:4566`) and skips when the emulator is down, so a green `make test` needs no running stack.

## Coverage

`make coverage` runs unit + integration with `-coverpkg=./internal/...`; `make coverage-unit` needs no Docker; `make coverage-check` fails under **95%**; `make coverage-html` writes the browsable report. The gate is a local convention — `dev` runs no CI.

## Load + e2e — traffic, not tests

k6 suites under `tests/load/`. One file — `infra/.env.load` (copy the template `.env.load.example`) — configures *everything*, `SCENARIO` included; there are no CLI overrides, so one edit re-arms the runner. `load-check` fires as a prerequisite of `load-test` and `load-e2e`: it rejects a missing env file or an unknown `SCENARIO` before compose runs.

```sh
make load-env        # create infra/.env.load from the example
make load-test       # container rig: chats + k6 on an isolated network
make load-e2e        # k6 alone, against whatever API_URL names
make load-down       # tear the rig down
```

`PROTOCOL` picks `http` (Connect over JSON) or `grpc` (native gRPC over H2C using reflection). Both probes stay HTTP.

| Scenario | Shape | Pass criteria |
|----------|-------|---------------|
| `smoke` | 1 VU, 1 iteration: health, a full lifecycle, the rejection matrix, a forced burst refusal | every request asserts its exact answer |
| `load` | `ramping-arrival-rate` from `STAGES`; each arrival creates a chat, runs a weighted workflow, deletes it | `p95 < 250ms`, `p99 < 500ms`, success ≥ 99% |

The smoke matrix maps the guards one to one: missing/wrong key and missing user id (`unauthenticated`), empty/oversized content and invalid cursor (`invalid_argument`), analysis without state (`invalid_argument`), unknown/foreign chat (`not_found`), and a burst-budget refusal. The owner pool (`CHATS_LOAD_OWNERS=4096`) keeps traffic off the limiter; exhausting it yields `chats_load_rate_limited` and fails the run. A readiness 503 during load is backpressure, not a failure; k6's exit code survives the teardown.

## The knobs

`infra/.env.load` carries the defaults: `PROTOCOL`, `API_URL`, `API_KEY`, `SCENARIO`, `STAGES`, `MAX_VUS`, `CHATS_LOAD_OWNERS`, the `CHATS_LOAD_MIX_*` weights, `CHATS_LOAD_DELETE_RATE`, `CHATS_LOAD_CONTENT_BYTES`, and the `CHATS_LOAD_P95_MS` / `P99_MS` / `MIN_SUCCESS_RATE` trio.

[Back to the briefing](../SKILL.md)
