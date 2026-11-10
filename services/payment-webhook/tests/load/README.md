# Load + e2e testing

k6 suites for the payment webhook. One `infra/.env.load` (copy the template
`infra/.env.load.example`) drives both commands; the tests only send traffic
and assert responses — the service under test is responsible for its own
observability.

## Commands

| Command | What it does |
|---|---|
| `make load-test` | Provisions the container rig (`infra/compose.load.yml`: service + k6 on an isolated network, no service host ports) and runs the scenario against it; `queue-up` brings the emulator into shape first |
| `make load-e2e` | Runs the k6 container only (`run --rm --no-deps`) against whatever `infra/.env.load`'s `API_URL` names — `make run`, a docker stack, prod |
| `make load-down` | Removes the rig and any e2e-run leftovers |

Everything is configured in `infra/.env.load` — `SCENARIO` included: edit the
file's `SCENARIO` line to pick the script, edit its other lines to change any
knob, then rerun. There are no CLI or shell overrides; compose injects the
file wholesale into the k6 container, so one edit re-arms the runner, while
the service plane keeps booting from `infra/.env` exactly as `make up` boots
it. The file defines only what k6 needs; ElasticMQ is never part of the rig —
the emulator stays external on `queue-up`'s terms, and the service reaches it
over the host gateway on whatever `infra/.env` says.

`PADDLE_WEBHOOK_SECRET` spans both files by nature: the service verifies with
`infra/.env`'s value and k6 signs with `.env.load`'s — they must match. The
defaults agree; an edited target needs its mirrored half in `.env.load`.

## Scenarios

| Scenario | File | What it is | Pass criteria |
|---|---|---|---|
| `smoke` | `scenarios/smoke.js` | 1 VU, 1 iteration: health, one 200 queueing per profile, the advisory row, then the full rejection matrix | every request asserts its exact answer |
| `load` | `scenarios/load.js` | `ramping-arrival-rate`, shaped by the file's `STAGES`: a light ramp (`5s:1,10s:2,5s:0`), a spike (`10s:10,30s:20,10s:0`), or a flat marathon (`4h:2`) | `p95 < 1000ms`, `p99 < 2000ms`, success `>= 99%` |

The smoke's rejection matrix maps the current route's guards one to one: a
missing, stale (past Paddle's ±5-minute window), wrong-secret, and malformed
`Paddle-Signature` (401), an oversized raw body past the read bound (413),
then the envelope gate's 422s — a missing `event_id`, a null `data`, a
non-RFC3339 `occurred_at`, and a body that never parses to an object. The
signature rows carry otherwise-valid small bodies, so the guard — not a
broken payload — rejects them. The advisory row is the counter-case: a body
with no addressable id that the route still queues (a counter server-side,
never a rejection).

The load run's shape is data, not a script: edit `STAGES` to go from a short
ramp to a spike to an overnight soak, and loosen the budget trio for heavier
shapes, then put the values back. Readiness is sampled every 10th arrival; a
`503` is recorded as backpressure, not a failure.

## Profiles

Every body is built at run time — deterministic Paddle-shaped envelopes
padded to the target with index arithmetic, no RNG, no corpus. Nothing to
generate: `load-test` and `load-e2e` run from a fresh tree as-is.

| profile | target | wire answer at the default boot |
| -------- | -------- | ------------------------------- |
| small    | target 200 B (the envelope's own floor sits at ~300 B) | 200 queued |
| mid      | ~4 KiB   | 200 queued |
| large    | ~64 KiB  | 200 queued |
| near-limit | ~250 KiB | 200 queued — the router clamps the read bound to SQS's 256 KiB message ceiling |
| oversize | ~284 KiB | 413 under every boot — the smoke matrix's stranded read-bound row |

The load run keeps every `event_id` unique per iteration, so queue dedup
never collapses the traffic; group identities fan out across
`WEBHOOK_LOAD_POOL` rotating subscription slots instead of serializing onto
one FIFO group.

## Knobs

Each knob is one env key read by its consumer with a built-in default
(`lib/config.js`): `STAGES` and `MAX_VUS` shape the run, `WEBHOOK_LOAD_PROFILES`
picks the mix, `WEBHOOK_LOAD_EVENT_TYPES` rotates the payloads' type,
`WEBHOOK_LOAD_POOL` sizes the group fan-out, `API_URL`/`PADDLE_WEBHOOK_SECRET`
aim and arm the runner, and the `WEBHOOK_LOAD_P95_MS`/`P99_MS`/
`MIN_SUCCESS_RATE` trio carries the budget. See
`infra/.env.load.example` for the full list.

Threshold breaches make k6 exit non-zero, and both commands propagate that
to the shell (`docker compose run` returns the k6 container's exit code) — a
green run is exit 0.
