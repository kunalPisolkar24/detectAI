# Load Testing

k6 load tests for the document parser. Uses `infra/compose.load.yml` to spin `document-parser + k6` isolated from the main stack.

## Scenarios

| Scenario | File | Executor | Default load profile | Key thresholds |
|---|---|---|---|---|
| `smoke` | `scenarios/smoke.js` | `vus: 1`, `iterations: 1` | health + one extract per `txt/pdf/docx` | all checks must pass |
| `load` | `scenarios/load.js` | `ramping-vus` | stages `5s:5,10s:5,5s:0`, 1-3s think time | `p95 < 1500ms`, `p99 < 3000ms`, txt `p95 < 500ms`, success `>= 99%` |
| `stress` | `scenarios/stress.js` | `ramping-arrival-rate` | stages `10s:5,30s:10,10s:0`, preallocated 20 / max 100 VUs | `p95 < 3000ms`, `p99 < 6000ms`, success `>= 95%`, readiness `503`s counted |
| `soak` | `scenarios/soak.js` | `constant-vus` | 2 VUs for 5m, graceful stop 30s | `p95 < 3000ms`, `p99 < 5000ms`, success `>= 99%` |
| `negative` | `scenarios/negative.js` | `shared-iterations` | 1 VU, 8 iterations over 4 rejection cases | rejection success `== 100%` |
| `legacy` | `script.js` | `ramping-vus` or `ramping-arrival-rate` | legacy `MODE=vus\|rps` interface | scoped `http_req_duration` per scenario, success `>= 99%` |

Payloads: every scenario picks fixtures deterministically by iteration index, round-robining over `DOCPARSER_LOAD_PROFILES` (default `txt-small,txt-medium,txt-large,pdf-small,docx-small`). Binary fixtures live in `fixtures/` (`sample.pdf` 787B, `sample.docx` 36K); txt sizes are committed variants (`sample.txt` 26B, `sample-medium.txt` 4K, `sample-large.txt` 100K, `sample-near-limit.txt` 500K, opt-in via profile `txt-near-limit`). `negative` posts unsupported-mime (`415`), empty-txt, corrupt-pdf, and missing-file cases and passes only when the service rejects with the expected `4xx`.

Every iteration runs with tags `service:document-parser`, `test_type`, plus `mime`, `profile`, and `size` on extract metrics so the New Relic `loadtest` dashboard panels (per-mime p50/p95/p99, pool utilization, queue wait by mime) stay correlatable.

## Quick Start

```bash
# from services/document-parser
make load-test SCENARIO=smoke
make load-test SCENARIO=load VUS=20 DURATION=1m RAMP_TIME=30s
make load-test SCENARIO=stress RPS=20 STAGES="10s:5,30s:20,10s:0" MAX_VUS=100
make load-test SCENARIO=soak VUS=2 DURATION=10m
make load-test SCENARIO=negative
make load-test SCENARIO=legacy MODE=rps VUS=50 RPS=100 DURATION=2m
make load-down                          # down -v
```

Aliases: `make load-test-smoke`, `load-test-load`, `load-test-stress`, `load-test-soak`, `load-test-negative`.

## Running Against an Existing Deployment

The rig above is self-contained: it starts a throwaway parser and its own k6. To measure a deployment that is already running -- a local stack, the Floci stack, prod -- run the same scripts against it instead. Nothing is provisioned: the k6 container runs with `--no-deps`, so the parser under test is never started by the load run.

```bash
# The target file carries the endpoint and any credentials.
# See e2e/targets/.env.example for the template.
make load-test REMOTE=1 TARGET_ENV_FILE=../../e2e/targets/.env.prod SCENARIO=load
```

`REMOTE=1` switches the run to `docker compose run --rm --no-deps k6`, in its own compose project (`e2e-document-parser`) so it never disturbs a running local rig. The scenario knobs (`VUS`, `DURATION`, `RPS`, `STAGES`, `MAX_VUS`, `ITERATIONS`) work exactly as they do in rig mode.

Observability is the target's business here: a deployed stack already exports its own traces, metrics and logs, so `WITH_OBSERVABILITY` is ignored in remote mode and says so.

Use the cross-app harness in `e2e/` to drive this and the other services together:

```bash
make -C e2e load TIER=smoke TARGET=prod
```

## Observability (opt-in)

```bash
# Push traces/metrics/logs to New Relic EU as deployment.environment=loadtest
export NEW_RELIC_LICENSE_KEY="..."      # ingest key, never commit
make load-test SCENARIO=load WITH_OBSERVABILITY=1 VUS=50 DURATION=2m
```

Adds `otel-collector-loadtest` on `loadnet` (scrapes `/api/v1/metrics`,
collects per-container CPU/mem/net via `docker.sock` plus host CPU/mem,
exports OTLP to EU). `ENV_TYPE` stays `dev` — only the
telemetry label changes, so k6 traffic shows up in the
`detectai-document-parser (loadtest)` dashboard and never pollutes prod boards.
Without the flag (default `WITH_OBSERVABILITY=0`) the run is unchanged and
fully offline. Empty license key = collector retries/drops, apps keep running.

Tip: infra panels (saturation, containers) need a run of a few minutes to
fill — the parser scrape and container stats tick every 15s. Short
smoke runs only populate the span/log panels. Memory % panels rely on the
`mem_limit`s set in `compose.load.observability.yml` (parser 2g, k6 1g,
collector 512m).

Or directly:

```bash
SCENARIO=load docker compose -f infra/compose.load.yml up --abort-on-container-exit --exit-code-from k6
```

## Env

| Var | Default | Used |
|---|---|---|
| `SCENARIO` | `load` | `smoke\|load\|stress\|soak\|negative\|legacy` → `load/scenarios/<name>.js` (`legacy` → `load/script.js`) |
| `API_URL` | `http://document-parser:8000` | k6 target |
| `VUS` | per scenario | elegant override: smoke/soak/negative VUs, stress preallocated VUs, legacy VUs |
| `DURATION` | per scenario | elegant override: soak duration, legacy hold duration |
| `RAMP_TIME` | `5s` | legacy `script.js` ramp up/down |
| `RPS` | `10` | elegant override: stress start arrival rate, legacy rps target |
| `STAGES` | per scenario | elegant override: `DOCPARSER_LOAD_STAGES` + `DOCPARSER_LOAD_STRESS_STAGES` (`duration:target` entries) |
| `MAX_VUS` | `100` | elegant override: stress max VUs |
| `MODE` | `vus` | legacy only: `vus` → `ramping-vus`, `rps` → `ramping-arrival-rate` |
| `DOCPARSER_LOAD_PROFILES` | `txt-small,txt-medium,txt-large,pdf-small,docx-small` | deterministic fixture mix (`txt-near-limit` opt-in) |
| `DOCPARSER_LOAD_REQUEST_TIMEOUT` | `35s` | per-request timeout, covers the 30s `EXTRACTION_TIMEOUT_SECONDS` plus margin |
| `WITH_OBSERVABILITY` | `0` | `1` → also start `otel-collector-loadtest`, push to New Relic as `loadtest` |
| `WORKERS` | `1` | load-stack gunicorn workers (fit-on-one-machine default; not prod capacity) |

Per-scenario thresholds and sizing use `DOCPARSER_LOAD[_STRESS|_SOAK|_NEGATIVE]_*` vars (see `infra/compose.load.yml` for the full list). Setting one directly takes precedence over the elegant mapping.

## How it Works

- `lib/config.js` parses `DOCPARSER_LOAD_*` env (`stages`, durations, ratios) with the same `duration:target` grammar as the inference suite.
- `lib/files.js` preloads fixtures once per VU via `open(..., 'b')` and picks them round-robin by `exec.scenario.iterationInTest`, so every run covers the full mix reproducibly.
- `lib/requests.js` posts `multipart/form-data` to `POST /api/v1/extract` with an explicit `35s` timeout, checks `status 200` and `json.text`, and records `docparser_<scenario>_{duration,success_rate,failures,timeouts}` tagged by `mime/profile/size/status`. `504`s and 30s+ timings increment the timeout counter; `/ready` `503`s increment the readiness counter instead of failing the build.
- `legacy script.js` keeps the old `MODE` interface but now shares the same lib, so its health probe no longer skews extract latency (thresholds are scoped per `scenario` tag).

## When to Run

- **Smoke** before any deploy — health plus one extract per mime, fails fast.
- **Load** (`VUS=10-20`, `2m`) to verify `p95<1500ms` and `>=99%` success on a realistic mix.
- **Stress** (`RPS=10-20` spike) to catch `extraction_pool` saturation — watch `docparser_stress_readiness_not_ready_total` and queue depth, expect graceful `503` on `/ready` rather than extract errors.
- **Soak** (`VUS=2`, `5-30m`) with observability on to catch leaks and `extraction_duration_seconds p95` drift.
- **Negative** after touching validation or limits — verifies `413/415/422` guards still reject without tripping error budgets.
