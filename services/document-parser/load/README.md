# Load + e2e testing

k6 suites for the document parser. One `infra/.env.load` (copy the template
`infra/.env.load.example`) drives both commands; the tests only send traffic
and assert responses — the service under test is responsible for its own
observability.

## Commands

| Command | What it does |
|---|---|
| `make load-test` | Provisions the container rig (`infra/compose.load.yml`: parser + k6 on an isolated network, no host ports) and runs the scenario against it |
| `make load-e2e` | Runs the k6 container only (`run --rm --no-deps`) against whatever `infra/.env.load`'s `API_URL` names — `make run`, a docker stack, a Lambda function URL, prod |
| `make load-down` | Removes the rig and any e2e-run leftovers |

`SCENARIO` picks the script: the CLI value wins, then the `infra/.env.load`
value, then `smoke`. Every other knob lives in `infra/.env.load`; a CLI shape
key (`VUS=`, `ITERATIONS=`...) stays as an escape hatch and wins over the file.

## Scenarios

| Scenario | File | Executor | Default profile | Key assertions |
|---|---|---|---|---|
| `smoke` | `scenarios/smoke.js` | `vus: 1`, `iterations: 1` | health + one extract per `txt/pdf/docx` | all checks must pass |
| `negative` | `scenarios/negative.js` | `shared-iterations` | one pass over the rejection matrix | exact `401/413/415/422`, no 500s |
| `load` | `scenarios/load.js` | `ramping-vus` | stages `5s:5,10s:5,5s:0`, 1-3s think time | `p95 < 1500ms`, `p99 < 3000ms`, txt `p95 < 500ms`, success `>= 99%` |
| `stress` | `scenarios/stress.js` | `ramping-arrival-rate` | stages `10s:5,30s:10,10s:0`, preallocated 20 / max 100 VUs | `p95 < 3000ms`, `p99 < 6000ms`, success `>= 95%`; readiness `503`s counted, not failed |
| `soak` | `scenarios/soak.js` | `constant-vus` | 2 VUs for 5m | `p95 < 3000ms`, `p99 < 5000ms`, success `>= 99%` |
| `legacy` | `script.js` | `MODE=vus|rps` | ramp to `VUS` for `DURATION` (or arrival-rate at `RPS`) | scenario-scoped thresholds |

The negative matrix maps the current route's guards one to one: a missing and
a wrong `x-api-key` (401), an oversized body past the upload limit (413), an
unsupported sniffed mime (415), corrupt pdf content and a multipart body with
no `file` field (422). Every case carries the configured key unless it tests
the 401 guard itself.

## Knobs

Scripts resolve each knob in three steps (`load/lib/config.js`): the
scenario-specific `DOCPARSER_LOAD_*` key first, then the `infra/.env.load` generic
(`STAGES`, `ITERATIONS`, `DURATION`, `VUS`, `RPS`, `MAX_VUS`), then the
built-in default. Target and budget keys are always their explicit
`DOCPARSER_LOAD_*` names. See `infra/.env.load.example` for the full list.

Threshold breaches make k6 exit non-zero, and both `load-test`
(`--exit-code-from k6`) and `load-e2e` (exit of `run`) propagate that to the
shell — a green run is exit 0.
