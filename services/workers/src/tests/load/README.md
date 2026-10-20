# Workers Load Testing

Containerized k6 rigs for the workers service. Each rig boots one worker with
isolated datastores, runs k6 against the load-testing proxy
(`src/tests/load/proxy.ts`), and asserts both sides of the pipeline: the proxy
accepted the traffic *and* the worker actually processed it.

## Rigs

| Worker | Rig | What it proves |
|---|---|---|
| `payments` | `infra/compose.load-payments.yml` | Events are ingested, deduped by `event_id`, and materialize the expected subscription state |
| `analytics` | `infra/compose.load-analytics.yml` | Usage events are deduped and flushed with the exact count sent |
| `cron` | `infra/compose.load-cron.yml` | Seeded expired subscriptions drain within a bounded time and the sweeper reports no errors |

```bash
cd services/workers

# Small correctness profile (~60 requests, passes on a laptop)
make load-check WORKER=payments
make load-check WORKER=analytics
make load-check WORKER=cron

# Full runs (dedicated hosts; see thresholds below)
make load-test WORKER=payments VUS=10 DURATION=2m RPS=50
make load-test WORKER=cron SEED_COUNT=1000

# Cleanup (removes the rig's volumes)
make load-down WORKER=payments
```

One rig at a time: the container names (`worker_payments`, ...) are fixed, so a
rig cannot run alongside a dev stack for the same worker.

## Watching a run in New Relic

Rigs are offline by default: no collector, no network calls. Add
`WITH_OBSERVABILITY=1` to stream the run into the `detectai-workers (loadtest)`
board (see `infra/observability/`):

```bash
export NEW_RELIC_LICENSE_KEY="eu01..."   # ingest key, shell only, never commit

make load-test WORKER=analytics WITH_OBSERVABILITY=1 VUS=10 DURATION=2m RPS=50
```

This adds `otel-collector-loadtest`, which scrapes the worker's `/metrics`,
collects host and container metrics, and exports traces, metrics and logs with
`deployment.environment=loadtest` — the same label every other service's load
rig uses, so k6 runs never land on prod boards.

The collector targets the worker's in-network port (`7001` analytics, `7002`
cron, `7003` payments), not the remapped host port, so several rigs can be
inspected side by side. A missing `NEW_RELIC_LICENSE_KEY` is a warning, not a
failure: the exporter retries and drops while the worker keeps processing, and
k6 thresholds are unaffected.

The rig also runs the datastore exporters (postgres, redis, and rabbitmq for
the queue-backed rigs) so the board's `Infra` page has data too. The
collector's scrape interval is 5s here, not the 15s the shared collector config
defaults to: a rig is torn down about 40s after the worker boots, and at 15s
the collector never closes a series that only changed once — the cron
histograms (`Batch size and expiry lag`) never reached New Relic at all.

## Three layers of verification

1. **Ingest checks** (`worker_ingest_success`, `checks`): the proxy returned 200.
2. **Row verification** (`worker_verify_success`, `worker_verify_duration`):
   `VERIFY_SAMPLE_RATE` of iterations use a *single-use* user id and then poll
   `/verify/*` until the row appears with the expected shape — payments require
   `found && status === ACTIVE`, analytics requires `total === count`. Because
   the identity is used once per run, the row can only have been produced by the
   event just published: a lost publish or a stalled worker fails the run
   instead of passing on an older row.
3. **Worker signals** (teardown, gated on `worker_health_check`): k6 scrapes the
   worker's `/metrics` (`WORKER_METRICS_URL`) after draining the queues and
   asserts:

   | Assertion | Metric |
   |---|---|
   | every published event accounted for | proxy `/stats` vs `worker_jobs_processed_total` + duplicates |
   | no failed jobs (any error type) | `worker_job_errors_total` |
   | nothing dead-lettered | `worker_dead_lettered_total` |
   | no unhandled event types | `worker_unhandled_events_total{event_type="other"}` |
   | nothing requeued for infra faults | `worker_infra_requeued_total` |
   | dedup path exercised | `worker_duplicate_events_total` (payments) / `worker_cron_stale_events_filtered_total{reason="duplicate"}` (analytics) |
   | cancel path exercised | `worker_jobs_processed_total{job_type="subscription.canceled"}` (payments only; skipped when pool slots are shared) |
   | worker never restarted | `process_start_time_seconds`, unchanged since setup |
   | broker queue drained | proxy `/queue-depth` for `<queue>`, `<queue>_retry`, `<queue>_dlq` |
   | cron swept and drained | `worker_cron_loop_iterations_total{result}`, `worker_cron_expired_backlog` |

   `cancel path exercised` exists because `SubscriptionCanceledHandler` logs
   nothing: without it, a run where the random mix stopped producing cancels
   would report success while the `CANCELED` branches of the state machine went
   untested. Like the dedup guard it needs the run to be long enough to actually
   draw the event.

   A single failed assertion makes the run fail. Teardown waits for the retry
   queue to empty before checking the DLQ, because a failed message sits in the
   retry queue for its TTL.

### Conservation: the assertion that catches silent data loss

Every other teardown gate is satisfied by a queue that merely emptied — a
worker that discarded 90% of its messages would drain the queue, log nothing
and dead-letter nothing. So the proxy counts every publish the broker confirms
and exposes it on `GET /stats`, and teardown reconciles that against the
worker's own counters:

```
processed + deduplicated >= published
```

A worker only counts a job once it has committed it, and the two paths that
skip a job both increment a counter (`worker_duplicate_events_total` for
payments, `worker_cron_stale_events_filtered_total{reason="duplicate"}` for
analytics), so the sum is exact and anything short means work vanished. Teardown
polls for it (`SIGNAL_TIMEOUT_MS`) because draining the queue proves the broker
is empty, not that the last in-flight message has been counted yet.

Restart detection exists for the same reason: `restart: always` on the worker
container resets every in-process counter, which would otherwise turn a crashed
worker into a confusing "counters look zero" mystery. `setup()` records
`process_start_time_seconds` and teardown fails the run if it moved.

### What the edge scenario does and does not cover

`SCENARIO=edge` asserts that the **load proxy** rejects malformed payloads with
400s — every case is caught by the proxy's own zod schemas
(`src/tests/load/proxy.ts`), so nothing is ever published. It is not coverage of
the workers' own input validation, and it cannot be: a payload that reached the
worker and was rejected would be dead-lettered, which the happy-path rigs assert
is zero. Edge runs still execute teardown, and edge-mode teardown still gates on
`worker_health_check` and `worker_teardown_runs` — it only skips the
published/conservation and dedup assertions, which have no traffic to be about.

## SCENARIO=invalid: worker-side validation coverage

`edge` stops at the proxy, so the workers' own input validation was untested.
`SCENARIO=invalid` covers it with the gate inverted: payloads that the proxy
**accepts** and the worker **rejects**, so the DLQ is expected to fill.

```bash
make load-test WORKER=payments  SCENARIO=invalid VUS=2 DURATION=20s
make load-test WORKER=analytics SCENARIO=invalid VUS=2 DURATION=20s
```

No proxy route is needed for this. Payments overrides individual `data` fields —
the proxy spreads `...body.data` last into the published payload, and its own
schema types `data` as a free-form record — so `status`, `customer_id` and
`occurred_at` can each be made invalid individually. Analytics has only one
lever: `eventId` must be a UUID to the worker but merely `min(1).max(128)` to the
proxy. Note the proxy *generates a valid UUID* when `eventId` is absent, so a
"missing eventId" case would be accepted rather than rejected.

Each case throws `MissingFieldError`, which is non-retryable
(`isRetryableError.ts`), so messages dead-letter on the first attempt rather than
burning the retry budget and a 5s `RETRY_TTL_MS` per message.

Teardown asserts the inverted outcome, and the same conservation property with
"accounted for" meaning *dead-lettered* instead of processed:

| Assertion | Expected |
|---|---|
| `<queue>_dlq` received dead letters | non-empty |
| every invalid payload dead-lettered | `dead_lettered >= published` |
| worker handled none of them | `worker_jobs_processed_total == 0` |
| payments only: rejections were validation errors | `error_type` = `missing_status` / `missing_customer_id` / `missing_occurred_at`, each `>= 1` |
| nothing requeued for infra faults | `worker_infra_requeued_total == 0` |

The per-`error_type` assertions are what prove each override did what it was
supposed to: if one silently failed to apply, the proxy and worker would both
accept it, `processed` would be non-zero and the run fails.

`worker_invalid_check` is gated on `rate==1`, not `>=`. These payloads must get
*through* the proxy to reach the worker, so a single future proxy change that
started rejecting them would otherwise leave the scenario passing while
exercising nothing. Analytics deliberately asserts no `error_type`: it validates
in `cmd/analytics/index.ts` before the service, so `job_errors_total` stays `0`
while `dead_lettered_total` increments.

## Guards against vacuous passes

k6 silently ignores Rate/Trend thresholds that have zero samples, and
`count>0` on a zero-sample Counter fails (verified against k6 0.55 in this
repo). The rigs use that asymmetry:

- `worker_verify_samples` (`count>0`) fails a run where no verification
  happened — e.g. `VERIFY_SAMPLE_RATE=0`.
- `worker_teardown_runs` (`count>0`) fails a run where teardown never executed.
- `dropped_iterations` (`count==0`) fails arrival-rate runs where verify polling
  parked every allowed VU, which would silently lower the configured RPS.
- `worker_negative_check` thresholds exist only in `SCENARIO=edge`; elsewhere
  they would carry zero samples and prove nothing.
- `proxy published events` fails a run where the published count was zero,
  which would let the conservation assertion pass without comparing anything.

### A dropped series reads as zero

`seriesValue()` returns `0` for a series that is absent, which is the correct
reading for a counter that was never incremented — and is also how a *parse*
failure looks. Every `exact: 0` assertion is therefore only as trustworthy as
the exposition parser feeding it. If `LINE_RE` in `lib/workerSignals.js` fails
to match a labelled line (`name{job_type="..."} value`), the series silently
vanishes and the assertion passes on a zero that no worker ever reported. The
parser was regressed once already in exactly this way; when changing it, check
that labelled lines still match:

```js
import { parsePrometheus } from './lib/workerSignals.js';
parsePrometheus('worker_job_errors_total{job_type="usage_event"} 3'); // [{name, labels, value}]
```

### Request phases

Every HTTP request carries a `phase` tag, and the SLOs are scoped to the phases
they describe:

| Phase | Requests | Gated? |
|---|---|---|
| `ingest` | `POST /payments`, `POST /analytics` | yes — `http_req_failed`, `http_req_duration` |
| `verify` | `GET /verify/*` polling | yes — `http_req_failed`, `http_req_duration` |
| `seed` | `POST /cron/seed` | yes — `http_req_failed`, `http_req_duration` |
| `setup` | `GET /ready`, `POST /seed-users`, boot-time scrape | no |
| `probe` | `GET /queue-depth`, `GET /stats`, `GET /metrics` | no |
| `drain` | `GET /verify/cron` polling | no |
| `edge` | invalid-payload battery | no — `worker_negative_check` instead |
| `invalid` | worker-invalid battery | no — `worker_invalid_check` instead |

This matters more than it looks. k6 emits `http_req_*` samples for requests made
in `setup()` and `teardown()` just like any other, and those loops retry on
purpose. Gated globally, a single retried `/ready` probe counts as an ingest
failure — and in `load-check` (~60 requests) one sample out of 61 is 1.6%, which
already breaches `rate<0.01`. Every retry loop in the rig (`/ready`,
`/verify/*`, `/verify/cron`, `/queue-depth`) is a request the design expects to
be able to fail, so none of them belong in an SLO.

## Knobs

The Makefile forwards these to the k6 container (defaults live in
`src/tests/load/lib/config.js`):

| Variable | Default | What it does |
|---|---|---|
| `VUS`, `DURATION`, `RPS` | per scenario | Generic overrides, honoured by every scenario |
| `SCENARIO` | `load` | `load`, `smoke`, `stress`, `soak`, `edge`, `invalid` |
| `POOL_SIZE` | `100` | Seeded users shared across VUs (bounded DB growth) |
| `RUN_ID` | generated | Run prefix; isolates identities between runs |
| `VERIFY_SAMPLE_RATE` | `0.1` | Share of iterations that verify a single-use row |
| `VERIFY_TIMEOUT_MS` / `VERIFY_POLL_MS` | `5000` / `500` | Verify poll budget (blocks the VU) |
| `DUP_WEIGHT` | `0.05` | Share of iterations sending the same event id twice |
| `SEED_COUNT` | `1000` | Cron rig: expired subscriptions to seed and drain |
| `SEED_AGE_SECONDS` | `30` | Cron rig: how long ago seeded rows expired |
| `CRON_VERIFY_TIMEOUT_MS` | derived | Cron drain budget; `ceil(SEED_COUNT/CRON_BATCH_SIZE)*5s + 60s`, floor 180s |
| `CRON_VERIFY_POLL_MS` | `2000` | Cron drain poll cadence |
| `CRON_BATCH_SIZE` | `100` | Must match the worker's configured batch size |
| `SIGNAL_TIMEOUT_MS` / `SIGNAL_POLL_MS` | `20000` / `1000` | Teardown waits (queue drain, conservation, backlog settle) |
| `WORKER_METRICS_URL` | per rig | Worker `/metrics` endpoint |
| `MOCK_MODE` | `false` | Mock proxy: no rows written, so k6 skips verification and the worker-signal assertions. Forwarded to **both** the proxy and k6 containers, since the runtime skip and the threshold skip read it from separate processes |
| `THRESHOLD_*` | (see `lib/config.js`) | Per-run threshold overrides |
| `WITH_OBSERVABILITY` | `0` | `1` → also runs `otel-collector-loadtest`, pushing traces, metrics and logs to New Relic as `deployment.environment=loadtest` |

Short runs need higher mix weights: at ~60 iterations a 5% dup weight yields
zero dup pairs about 5% of the time, so `load-check` uses
`DUP_WEIGHT=0.25 VERIFY_SAMPLE_RATE=0.25`.

`POOL_SIZE` below `VUS` shares one user across VUs, which is a legitimate way
to create contention but gives up per-user event ordering — several VUs publish
into the same slot concurrently. The payments rig drops
`subscription.canceled` from the mix in that configuration, because a cancel can
land on a row that does not exist yet and the state machine rejects
`null -> CANCELED` (the other event types all resolve to `ACTIVE`, which is
legal from every state). With the default `POOL_SIZE=100` and `VUS=10` the full
mix including cancels is used.

### Per-user event ordering (payments)

A payments pool user gets a created-first lifecycle, and two separate things
have to hold for that to mean anything:

1. **The slot's first *pool* event must be `subscription.created`.** It cannot
   be keyed off `__ITER`, because a verification iteration consumes an iteration
   without producing a pool event. When iteration 0 is drawn for verification,
   the slot's first pool event arrives at iteration 1+, which the mix treats as
   "not first" — and a cancel there hits a user with no subscription row. The
   script therefore counts pool events separately (`poolEvent`).
2. **Queue order must imply processing order.** With `prefetch > 1` the worker
   can start a slot's second event while its first is still in flight. The guard
   in `lockAndUpdateSubscription` is `SELECT ... FOR UPDATE`, which takes no lock
   on a row that does not exist yet, so a concurrent cancel reads "no row" and
   dead-letters. `load-check` pins `RABBITMQ_PREFETCH=1` for payments; throughput
   profiles must pass `RABBITMQ_PREFETCH` explicitly.

Get (1) wrong and the rig provokes a dead letter; get (2) wrong and it does so
intermittently. Both surface as a single dead letter with conservation one short
of published.

## Scenario defaults

| Scenario | Shape |
|---|---|
| `smoke` | Constant VUs (2, or `VUS`), `DURATION` (30s) |
| `load` | Constant arrival rate: `RPS` (payments 10, analytics 20) for `DURATION` (30s) |
| `stress` | Ramping arrival rate to 3x `RPS` over 4 minutes |
| `soak` | Constant arrival rate `RPS` (or 5) for `DURATION` (or 10m) |
| `edge` | Invalid payloads only (400s); keeps happy-path SLOs clean |
| `invalid` | Worker-invalid payloads: proxy accepts, worker rejects, DLQ fills |

## Thresholds are host budgets, not laptop numbers

Defaults in `lib/config.js` describe dedicated hosts. On a laptop, override per
run instead of editing them:

```bash
THRESHOLD_INGEST_P95=2000 THRESHOLD_VERIFY_P95=4000 \
  make load-check WORKER=payments
```

Do not lower `THRESHOLD_SUCCESS_RATE`/`THRESHOLD_NEGATIVE_RATE` to make a run
pass: they are the actual SLO gates.

## Proving the gates fire (red runs)

Each guard was validated by making it trip; keep them when changing the rigs:

```bash
# Tripwire: verification never runs
make load-test WORKER=payments SCENARIO=load RPS=2 DURATION=20s VUS=2 VERIFY_SAMPLE_RATE=0
# Expect: threshold worker_verify_samples count>0 crossed

# Tripwire: the worker never processed what was published
# (point WORKER_METRICS_URL at a worker whose jobTotal is held at 0, or publish
# to a queue nothing consumes — /stats keeps counting, the worker never does)
# Expect: 'published events accounted for' fails

# Tripwire: worker restart mid-run
docker restart worker_payments   # while a run is in flight
# Expect: 'worker did not restart' fails

# Tripwire: DLQ never fills in SCENARIO=invalid (worker accepts everything)
# Expect: '<queue>_dlq received dead letters' fails

# Tripwire: cancel coverage lost — drop subscription.canceled from
# paymentsEventFor's mix, leaving 'cancel path exercised' with no samples
# Expect: 'cancel path exercised' fails

# Cron drain budget too small for the seed
make load-test WORKER=cron SEED_COUNT=200 CRON_VERIFY_TIMEOUT_MS=6000
# Expect: 'cron: sweeper drained backlog' check fails, worker_health_check rate=0

# Worker stops mid-run (docker pause)
docker pause worker_payments   # while a run is in flight, then unpause
# Expect: verify rate drops, then teardown job/queue assertions fail
```

## Troubleshooting

- **`worker /metrics reachable` failed**: wrong `WORKER_METRICS_URL` (ports:
  payments 7003, analytics 7001, cron 7002) or the worker crashed. Check
  `make worker-logs`/`docker compose logs`.
- **`dropped_iterations` crossed**: verify polling parked all VUs. Raise `VUS`,
  lower `VERIFY_SAMPLE_RATE` (keep it > 0) or lower `VERIFY_TIMEOUT_MS`. This is
  also a genuine signal that the worker cannot materialize rows under load.
- **`<queue>_retry` not drained**: a message keeps failing; look for retry
  metrics and worker logs before assuming a rig bug.
- **`published events accounted for` failed**: the broker confirmed more
  publishes than the worker ever accounted for. The detail line prints both
  sides (`processed+deduped=N published=M`). Either the worker dropped work, or
  it was still counting the last in-flight messages when `SIGNAL_TIMEOUT_MS`
  ran out — raise `SIGNAL_TIMEOUT_MS` before treating it as a real loss.
- **`worker did not restart` failed**: `process_start_time_seconds` moved between
  setup and teardown, so the worker container restarted mid-run and every
  counter was reset. This almost always means an OOM-kill or a crash loop; check
  `make worker-logs` (or `docker compose logs`) rather than the thresholds.
- **`proxy published events` failed**: the proxy confirmed zero publishes while
  the scenario was not `edge`. The requests never reached the broker, so this is
  a proxy or broker problem, not a worker one.
- **Analytics dedup assertion**: analytics duplicates surface under
  `worker_cron_stale_events_filtered_total{reason="duplicate"}` — a legacy name
  inside the shared `MetricsService` (follow-up: rename).

## Related

- `services/chats/tests/load/README.md` — the same pattern for the chats service
- `docs/getting-started/configuration.md` — worker settings referenced above
