# Load + e2e testing

k6 suites for the chats service. One `infra/.env.load` (copy the template
`infra/.env.load.example`) drives both commands; the tests only send traffic
and assert responses — the service under test is responsible for its own
observability.

## Commands

| Command | What it does |
|---|---|
| `make load-test` | Provisions the container rig (`infra/compose.load.yml`: chats + k6 on an isolated network, no service host ports) and runs the scenario against it; `db-up` and `cache-up` bring the local mongo and redis into shape first |
| `make load-e2e` | Runs the k6 container only (`run --rm --no-deps`) against whatever `infra/.env.load`'s `API_URL` names — `make run`, a docker stack, prod |
| `make load-down` | Removes the rig and any e2e-run leftovers |

Everything is configured in `infra/.env.load` — `SCENARIO` included: edit the
file's `SCENARIO` line to pick the script, edit its other lines to change any
knob, then rerun. There are no CLI or shell overrides; compose injects the
file wholesale into the k6 container, so one edit re-arms the runner, while
the service plane keeps booting from `infra/.env` exactly as `make up` boots
it. The file defines only what k6 needs — mongo and redis are never part of
the rig: the local stacks stay external on `db-up` and `cache-up`'s terms, and
the service reaches them over the host gateway on whatever `infra/.env` says.

`API_KEY` spans both files by nature: the service authenticates with
`infra/.env`'s value and k6 presents `.env.load`'s — they must match. The
defaults agree; an edited target needs its mirrored half in `.env.load`.

The rig boots the dev plane (`ENV_TYPE=dev`) and talks to the local redis
without a token, so the rig never reaches for the secrets plane.

## The wire

The service speaks the Connect protocol over HTTP, not gRPC: a unary call is
`POST {base_url}/chats.v1.ChatService/{Procedure}` with
`Content-Type: application/json`, `Connect-Protocol-Version: 1`,
`x-api-key`, and `x-user-id`. The owner of every chat is the `x-user-id`
header, not a request field. A refused call answers with the Connect code's
HTTP status and a `{"code": "...", "message": "..."}` body:

| Guard | Status | Code |
|---|---|---|
| missing or wrong `x-api-key`, missing `x-user-id` | 401 | `unauthenticated` |
| empty or over-long content, malformed cursor, analysis without a state | 400 | `invalid_argument` |
| unknown chat, another owner's chat | 404 | `not_found` |
| burst budget spent | 429 | `resource_exhausted` |

## Scenarios

| Scenario | File | What it is | Pass criteria |
|---|---|---|---|
| `smoke` | `scenarios/smoke.js` | 1 VU, 1 iteration: health, one full chat lifecycle, the rejection matrix, then the burst budget | every request asserts its exact answer |
| `load` | `scenarios/load.js` | `ramping-arrival-rate`, shaped by the file's `STAGES`: a light ramp (`5s:1,10s:2,5s:0`), a spike (`10s:10,30s:20,10s:0`), or a flat marathon (`4h:2`) | `p95 < 250ms`, `p99 < 500ms`, success `>= 99%` |

The smoke's lifecycle is the contract in one pass: create a chat, write a
message, read it back through the chat and through the history, list the
owner's chats, rename, read the new title, delete, and then prove the chat is
gone from all three reads. The rejection matrix maps the route's guards one to
one — a missing key, a wrong key, and a missing user id (401), an empty and
an over-long content (400), an unknown chat and another owner's chat (404), a
malformed cursor, and an analysis message without a state (400). Every row
runs on its own owner so one guard's traffic never spends another's budget.

The load run's shape is data, not a script: edit `STAGES` to go from a short
ramp to a spike to an overnight soak, and loosen the budget trio for heavier
shapes, then put the values back. Readiness is sampled every 10th arrival; a
`503` is recorded as backpressure, not a failure.

## The workload

One arrival is one self-contained conversation: the chat is created, one
weighted workflow runs against it, and the chat is deleted again — so the
datastore stays the size it was. The workflows are the read path (chat, its
history, the owner's sidebar), the write path (two messages and the history
that carries them), and the lifecycle path (a message, a rename, and the reads
that must see both). Their weights are the `CHATS_LOAD_MIX_*` knobs.

The burst budgets are counted per owner per minute: the create scope allows
`RATE_LIMIT_CREATE_MAX` creates and the write scope `RATE_LIMIT_WRITE_MAX`
writes. The run therefore draws its owner from a wide pool
(`CHATS_LOAD_OWNERS`, default 4096) in a global round robin, so the budget
holds as long as the pool covers the arrival rate:

```
owners >= 60 x (arrivals per second) / RATE_LIMIT_CREATE_MAX
```

A run that outgrows its pool is refused with a 429 and says so: the refusal is
counted separately (`chats_load_rate_limited`) and fails the run, because a
load test that measures the limiter measures nothing. Raise the pool, or raise
the target's own limits, when that happens.

## Knobs

Each knob is one env key read by its consumer with a built-in default
(`lib/config.js`): `STAGES` and `MAX_VUS` shape the run, `CHATS_LOAD_OWNERS`
sizes the owner spread, the `CHATS_LOAD_MIX_*` trio and
`CHATS_LOAD_DELETE_RATE` shape the workload, `CHATS_LOAD_CONTENT_BYTES` sizes
the written payload, `CHATS_LOAD_CREATE_LIMIT` mirrors the target's
`RATE_LIMIT_CREATE_MAX` for the smoke's budget row, `API_URL`/`API_KEY` aim
and arm the runner, and the `CHATS_LOAD_P95_MS`/`P99_MS`/`MIN_SUCCESS_RATE`
trio carries the budget. See `infra/.env.load.example` for the full list.

Threshold breaches make k6 exit non-zero, and both commands propagate that
to the shell (`docker compose run` returns the k6 container's exit code) — a
green run is exit 0.
