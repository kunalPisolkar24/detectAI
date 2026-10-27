# observability — DetectAI New Relic observability (Terraform)

Publishes **New Relic dashboards + email alerts** as code. EU region (`one.eu.newrelic.com`,
OTLP `https://otlp.eu01.nr-data.net:443`). Separate Terraform root from
`infra/terraform` on purpose: dashboards must survive datastore `destroy`, and this
root is pure New Relic — no `aws` provider (the only AWS touchpoint is the state
bucket bootstrap through the `aws` CLI).

## Layout

```
observability/
├── ci-workflow/          CI workflow source (fmt / validate / test)
└── terraform/            the root
    ├── main.tf           wiring: module "dashboards" + module "alerts"
    ├── variables.tf      account, api key, region, alert email, environment
    ├── outputs.tf        dashboards + alerts passthrough
    ├── versions.tf       required_providers + backend "s3" {}. providers.tf is newrelic only.
    ├── envs/             tfvars + .env.example template (.env gitignored)
    ├── tools/newrelic.py envs/.env validator + terraform driver (see Usage)
    ├── mk/               make fragments: local.mk (offline) + newrelic.mk (plane flows)
    ├── Makefile          aggregates both fragments
    ├── dashboards/       the boards module (see below)
    ├── alerts/           the alerting module (see below)
    ├── modules/dashboard/        one board + its grouping tags
    ├── modules/alert-condition/  one NRQL static condition
    └── tests/            run "dashboards_render" + "policies_fanout"
```

- `dashboards/` renders every board through `modules/dashboard`
  (`newrelic_one_dashboard_json` + `newrelic_entity_tags`), one module call per
  board in per-service files: `web.tf`, `payment-gateway.tf`, `workers.tf`,
  `inference.tf`, `document-parser.tf`, `chats.tf`, plus the platform pair
  `overview.tf` / `datastores.tf`. Each board's JSON sits in a per-service dir
  next to its wiring file (`web.tf` reads `web/prod.tftpl` + `web/dev.tftpl`):
  8 prod boards + 5 dev twins (`inference`, `overview`, `datastores` are
  prod-only by design); prod templates take `account_id` + `environment`,
  dev JSON hardcodes `dev`.
- `dashboards/web/prod.tftpl` — one board for the Next.js frontend and BFF
  (`service.name = web`). Pages: `Overview` (request rate, error share, p95,
  Apdex, container CPU/heap), `Service` (RED per route, status split,
  downstream dependency latency and errors, auth failures, AI inference
  latency, rate-limit and cache counters), `Service Logs` (error stream, log
  volume by level, errors by message, recent errors, slow requests) and
  `Infra` (DB query percentiles, cache behaviour, Node runtime, and the
  Postgres / Redis / RabbitMQ exporter panels). `web/dev.tftpl` is
  page-for-page identical with `'dev'` hardcoded and ` (dev)` appended to the
  panel titles, like the chats pair.
- Log pages share one layout across every board: the tables are full width
  (a log message needs the columns) and the two chart panels sit side by side
  at half width.
- `dashboards/workers/prod.tftpl` — one board for all three worker deployables
  (`worker-analytics`, `worker-cron`, `worker-payments`), each its own binary,
  container and `service.name`. Pages: `Overview` (cross-worker rollup: throughput,
  errors, broker/cache connectivity, DLQ, cron expiry lag), `Analytics`,
  `Analytics Logs`, `Cron`, `Cron Logs`, `Payments`, `Payments Logs`, `Infra`.
  Follows the `chats` precedent (multiple `service.name`s, one board, one page
  each) rather than a board per worker. Rates and counts come from `FROM Metric`
  (exact); percentiles come from spans (sampling shifts counts, not percentiles).
  Each worker page also carries that worker's own container resources via
  `docker_stats` with an exact `container.name = 'worker_<name>'` filter (prod
  stacks and load rigs name the containers the same), plus its eventloop lag,
  heap and message size. `Infra` covers the four datastores the workers depend
  on, gauges first, then one row per store, then tables: Postgres
  (`db_pool_connections` states, sweep transaction duration, DB-down requeues,
  sweep skips, plus the `postgres-exporter` backends/locks/longest transaction),
  Redis users + events (`redis_connection_status` per `client_name`, exporter
  memory/evictions/keyspace/clients) and RabbitMQ (app-side reconnects, consume
  duration percentiles, dead-letter log rate, plus broker-side queue depth and
  consumers). Worker-side widgets filter `service LIKE 'worker-%'`, so the
  `payment-gateway` copy of `rabbitmq_connection_status` never leaks in;
  exporter widgets facet on `service.name` (`redis-users`, `redis-events`).
  `workers/dev.tftpl` is page-for-page identical with `'dev'` hardcoded, except
  for the one panel that only one environment can fill: `Paddle API latency
  and cancels` needs a real call to Paddle's API, which only a user-initiated
  cancellation makes, so the prod board keeps it and the dev board shows
  `Cancel events/min` (the rig's cancel path) instead.
- `inference` is prod-only by design — the load rigs never run the AI service.
- Every board carries `team`, `managed-by`, `service`, `env` and `kind` tags,
  all explicit module args: platform boards are `kind = platform`, service
  boards `kind = service-dashboard`, dev twins `env = dev`.
- `alerts/` — one policy per area (`newrelic_alert_policy.area`, names
  `detectai-<area>-${environment}`) and the conditions in per-service files:
  `web.tf` (2), `gateway.tf` (2), `workers.tf` (4), `inference.tf` (2),
  `parser.tf` (5), `chats.tf` (1), `pipeline.tf` (1) — 17 conditions, each
  rendered through `modules/alert-condition` (60s windows, event_flow, 120s
  delay; thresholds per condition; `workers_broker_disconnected` static-fills
  its gauge with 1; `cron_expiry_lag` keeps violations 24h). All filter
  `deployment.environment = '${var.environment}'` so load-rig runs never page.
- `alerts/notifications.tf` — email destination + channel + workflow only.
- `tests/` — mocked provider runs: board counts, twin parity contracts, the
  Spark/Flare split, log layout rules, and the policy/workflow names.

## Usage

```bash
cd observability/terraform
make env            # create envs/.env from envs/.env.example (never overwrites)
make fmt validate test   # offline — no key needed
make check          # validate envs/.env + preview the resolved plane (LIVE=1 also resolves the account name)
make bootstrap      # create the .env plane's state bucket (idempotent, no key needed)
make plan           # terraform plan against the plane envs/.env selects
make apply          # terraform apply (auto on Floci, interactive confirm on real AWS)
```

### Credentials

`envs/.env` (gitignored) carries the credential triple the terraform root
needs; only the key is a real secret:

| `.env` key | Required | Feeds |
|---|---|---|
| `NEW_RELIC_API_KEY` | yes — User API key (`NRAK-...`), **not** the ingest license key | `TF_VAR_newrelic_api_key` |
| `NEW_RELIC_ACCOUNT_ID` | no (default `6428768`) | `TF_VAR_newrelic_account_id` |
| `NEW_RELIC_REGION` | no (default `EU`) | `TF_VAR_newrelic_region` |

`tools/newrelic.py` is the only brain: it parses the file, rejects an
ingest-license-key-shaped value, and drives terraform. Exporting
`NEW_RELIC_API_KEY` in the shell overrides the file for one invocation.
`LIVE=1 make check` additionally resolves the account name over GraphQL
(writes nothing) to catch a valid-looking key on the wrong account.

The root `Makefile`'s `obs-*` targets still point at the old `infra/observability`
path; until they are re-pointed, use this component Makefile (`make plan`) or
drive terraform directly with `-chdir=`. The CI workflow in `ci-workflow/`
already runs fmt/validate/test from the new directory.

### State

One backend declaration (`backend "s3" {}` in `versions.tf`), one plane per
run, resolved from `envs/.env` — the same single-flick contract as
`document-parser/tools/secrets.py` (plane selection, bucket default and
self-heal). No `backend.*.hcl` files, nothing copied, no extra config — and
no bare `./terraform.tfstate` mode: a run without an initialized backend
cannot plan/apply on a declared `s3` backend, so `make init`
(`-backend=false`) stays offline-only, for validate/test.

| `.env` keys | Plane | Rules |
|---|---|---|
| `EMULATOR_ENDPOINT` set (http(s) URL) | **Floci** | `TF_STATE_BUCKET` may stay empty — defaults to `detectai-observability-tfstate`; a health probe (`/_localstack/health`, 2s) runs before any aws call, so a dead emulator fails with a `make floci-up` hint instead of inside `init`; a missing bucket self-heals (`aws s3 mb` — the emulator's in-memory S3 loses buckets on restart); apply auto-approves. State key `observability/floci/terraform.tfstate` |
| `EMULATOR_ENDPOINT` empty | **real AWS** | `TF_STATE_BUCKET` required — no default, no guessing on a prod account; a .env-named bucket that is missing is created *and versioned* (S3-native state locking needs it); apply keeps the interactive confirm. State key `observability/terraform.tfstate` |

`AWS_REGION` (default `ap-south-1`) is the state bucket's region;
`NEW_RELIC_REGION` is the New Relic datacenter — different things, different
prefixes. `envs/.env` wins over the shell for the three state keys (a
conflicting shell export warns and is ignored — the state plane must be
reproducible); `NEW_RELIC_*` credentials work the other way (shell wins per
key).

**Recovering ownership**: the previous state lived in the Floci emulator's S3
bucket and did not survive an emulator restart (the bucket was not persisted).
The dashboards, policies and workflow it created are still live in New Relic —
the record of *which objects Terraform owns* is what is gone. Before the first
apply from a fresh state, import the live objects, or the apply will duplicate
them:

```bash
# Dashboard by entity GUID (visible on the board's NR page URL):
terraform import 'module.dashboards.module.overview.newrelic_one_dashboard_json.board' '<guid>'
# Alert resources follow account:id — check the registry import docs per resource:
terraform import 'module.alerts.newrelic_alert_policy.area["web"]' '6428768:<policy_id>'
terraform import 'module.alerts.newrelic_nrql_alert_condition.web_error_rate.condition' '6428768:<policy_id>:<condition_id>'
terraform import 'module.alerts.newrelic_workflow.email_all' '6428768:<workflow_id>'
```

`terraform plan` lists every address waiting for an ID: the 13 boards
(`module.dashboards.module.<name>.newrelic_one_dashboard_json.board`),
their tags, the 7 policies, the 17 conditions and the 3 notification objects.

## Data flow

Apps (`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`) ->
`otel-collector` in `infra/docker/prod/compose.yml` (prod stack only) ->
OTLP/HTTP to EU with `NEW_RELIC_LICENSE_KEY` (ingest key, from gitignored
`infra/docker/prod/.env`, never committed). Floci infra panels use exporter
sidecars (`profiles: [floci]`); prod infra panels use CloudWatch after the AWS
account link (see `dashboards/datastores/prod.tftpl` note).

The workers push only OTLP traces and logs, so their Prometheus metrics need a
Prometheus scrape: `infra/docker/prod/otel-collector-config.yaml` scrapes
`worker-analytics:7001`, `worker-cron:7002` and `worker-payments:7003`, which
is what feeds the worker-side widgets on the `Infra` page. The RabbitMQ broker
metrics need the exporter pointed at the management API
(`RABBITMQ_MGMT_URL` in `infra/docker/prod/.env`); the AMQP URL the apps use
leaves `rabbitmq_up` at 0 and no queue metrics at all.

The web app is scraped the same way, on `frontend:3000/api/metrics` (not
`/metrics`). Its endpoint only enforces a bearer token when
`PROMETHEUS_WEB_SCRAPE_TOKEN` is set, and the collector sends the same value:
both come from `infra/docker/prod/.env`, the app's copy through the
`detectai/web/secrets` secret. Change it in one place and re-seed, or the
scrape gets a 401 and the web board's Metric panels stay empty.

The web app also pushes logs over OTLP, which is what fills the `Service Logs`
page. The collector's `logs` pipeline only accepts OTLP, so without the log
exporter every `FROM Log` widget stays empty even though the logs are on
stdout. `document-parser` is the one service already pushing all three signals
straight to New Relic (`app/observability/`), the reference pattern for the
remaining services.

## Worker log export

Worker logs reach New Relic only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set;
otherwise the workers print JSON to stdout and no `FROM Log` widget has data.
Console output is unchanged either way — `Logger` writes to stdout and forwards to
an OTLP sink that is a no-op when the endpoint is unset, so a failing exporter
never blocks a worker. `shared/logging/sink.ts` holds the sink contract, and
`shared/logging/redact.ts` the masking, so neither depends on the `Logger` module
that unit tests replace wholesale.

### Datastore metrics in the load rigs

The prod stack scrapes its datastore exporters (postgres, redis, rabbitmq). The
worker load rigs used to scrape only the worker itself, so every `Infra` panel
that reads an exporter metric was blank there. `services/workers/infra/
compose.load.observability.yml` now adds the postgres and redis exporters to
every rig, and `compose.load.rabbitmq.yml` adds the rabbitmq exporter to the
queue-backed rigs only (the cron rig has no broker). The exporter atoms live at
`infra/docker/{postgres,redis,rabbitmq}-exporter/standalone.yml` and are merged
by extra `-f` flags in `services/workers/Makefile`; the collector's spare
scrape slots are pointed at them there. The rabbitmq exporter reads the
broker's **management** API, not the AMQP URL, and it retries until the broker
is up — it does not fail the rig.

The load collector scrapes every `OTEL_SCRAPE_INTERVAL` (5s in the worker rigs,
15s elsewhere). 15s is too slow for a short rig: the cron rig is torn down
about 40s after the worker boots, and at 15s the collector never closes the
cron histogram series, so `Batch size and expiry lag` read as empty. At 5s the
same rig lands them.

### What the infra metrics actually mean

The exporter metrics were checked against the datastores' own answers during a
load run (same window, same scrape):

| Board metric | Source of truth | Match |
|---|---|---|
| `redis_memory_used_bytes` | `INFO memory` -> `used_memory` | 1.09-1.34 MB vs 1.14-1.29 MB |
| `redis_connected_clients` | `INFO clients` -> `connected_clients` | 2 = 2 |
| `redis_evicted_keys_total` | `INFO stats` -> `evicted_keys` | 0 = 0 |
| `redis_db_keys` | `INFO keyspace` (per db) | sum matches; see below |
| `pg_stat_database_numbackends` | `pg_stat_database.numbackends` | 2-5 vs 0-4 |
| `pg_locks_count` | `count(*) FROM pg_locks` | 2-10 vs 0-2 |
| `pg_stat_activity_max_tx_duration` | `max(extract(epoch from now()-xact_start))` | 0-0.057 s vs 0-0.0009 s |
| `rabbitmq_queue_messages` | management API `/api/queues` | 0-1 vs 0-0 |
| `rabbitmq_queue_consumers` | management API `/api/queues` | 0-1 vs 0-1 |
| `container.memory.usage.total` | `docker stats` | 83.3-101.0 MiB vs 83.4-87.4 MiB |
| `container.cpu.utilization` | `docker stats` | 0.56-8.57 % vs 0.45-4.25 % |

Four readings that look wrong but are not:

- **`rabbitmq_queue_messages` is ready + unacknowledged**, not ready alone. The
  management API reports `messages = messages_ready + messages_unacknowledged`
  (confirmed: `m=1, r=0, u=1`), so the queue-depth panels show true depth.
- **`redis_db_keys` is per database** (db0..db15). Keyspace is the **sum**; the
  board uses `sum(redis_db_keys)`. A `max()` here reported the biggest single
  DB and understated the keyspace by ~5x.
- **`container.memory.percent` is usage divided by the container's cgroup
  limit.** The worker containers set no `mem_limit`, so their limit is the
  host's memory and the percentage reads as a share of host RAM. The board
  shows **memory used in MB** instead, which is unambiguous.
- **`container.cpu.utilization` is a percentage of a single core**, so it
  exceeds 100 % on a busy container. The panel title says so.

`worker_cron_expired_backlog` is an exact count, not an estimate. The sweeper
asks the database how many expired subscriptions are still pending, using the
same predicate the sweep selects on. Rows another instance holds a lock on
still count, so a backlog the batch size would have hidden shows up. The board
labels it *Expired backlog*.

`worker_cron_sweep_skipped_total` counts expired subscriptions the sweeper
selected but did not update, because a fresher webhook or a concurrent change
won the race. It is not a lock-contention counter: `FOR UPDATE SKIP LOCKED`
does not report how many rows it skipped.

## Empty worker panels: "no data" is not always "no signal"

Three NRDB behaviours decide whether a worker widget renders anything. Check
them before chasing an empty panel.

- **A labeled counter with no observations is absent, not zero.** prom-client
  emits a child series only after the first `.inc()`, so `worker_job_errors_total`
  and `worker_dead_lettered_total` reach New Relic only once that worker has
  actually errored or dead-lettered something. `Errors by type` and `Errors by
  type and job` are therefore blank on a clean run — that is the healthy state,
  and the same blank would appear if the worker stopped reporting altogether.
  `sum()` over an absent series is `0`, but over a series whose datapoints lack
  the board's `deployment.environment` it is `null`; the error-share widgets are
  ratios of that counter against `worker_jobs_processed_total` for this reason.
- **Cumulative counters are stored as per-interval deltas.** `sum()` over a
  window gives the total, but the final scrape is lost whenever the collector
  is stopped before its batch timeout (10s) expires — the load rig stops it as
  soon as k6 exits — so board totals trail the worker's own counters by about
  one 15s scrape interval. A run shorter than a single interval can land
  entirely inside that gap and read as zero.
- **A ratio over two metrics only holds as a whole-window aggregate.** Inside
  one time bucket one of the two metrics is absent, so the per-bucket ratio is
  `null`. `Cache hit rate (dedup lookups)` is a gauge for that reason: it
  computes `duplicates / (duplicates + processed)` across the selected window,
  and its per-bucket form would render empty.
- **A metric that only changes once may never get a scrape.** The cron rig's
  sweep happens in a two-second window, so at a 15s scrape interval the
  collector never observes the change and the series never reaches New Relic
  at all — not even as a zero. The worker rigs scrape every 5s for this
  reason; see "Datastore metrics in the load rigs" above.

`cache_operations_total` is the user-cache hit/miss counter and only the
payments worker increments it; the analytics worker's dedup counter is
`worker_cron_stale_events_filtered_total{reason="duplicate"}`.

### Panels that stay blank on purpose

These are correct when empty — the event they report never happened, so there
is no series to draw:

| Panel | Blank because |
|---|---|
| `Errors by type`, `Errors by type and job` | No error has ever been counted (labeled counter, never incremented) |
| `Postgres requeues/min (DB-down requeues)` | No DB-down event has ever been requeued |
| `Slow jobs over 1000ms` / `over 2000ms` | No job has run that long |
| `Stale events filtered (total)` (cron) | No sweep has ever filtered a phantom row |
| `Paddle API latency and cancels` | The load rig has no Paddle API to call, so the request timer is never observed |
| `Server error share` (web) | Nothing has thrown. Next.js sets the span error attribute for a thrown exception, so this counts 5xx, not the 4xx rejections the invalid scenario produces |
| `Slow requests over 1s` / `over 500ms` (web) | No request has run that long |
| `Rate limit rejections` (web) | The limiter refused once, and a counter that is incremented once is invisible: New Relic takes the first value of a cumulative series as its baseline, so only the increments after the first are ever seen. The load scenario also stops at the first refusal, which is shorter than the collector's scrape interval |
| `Cache hit and miss` (web) | The analyze path does not touch the user cache, so `cache_operations_total` has never been incremented |
| `Analytics publish failures` (web) | No publish has failed |
| `Usage Redis errors and sync fallback` (web) | The counter went from zero to five once, and the first value became the baseline (see `Rate limit rejections`) |
| `Redis memory and evictions` (web) | No key has been evicted |

`http.status_code` is stored as a number, not a string: `http.status_code IN
('401', '403')` matches nothing, while `http.status_code IN (401, 403)` matches
every 401. Faceting by the attribute works either way, which is how a panel can
show a status chart while the panel that filters on the same attribute counts
nothing.

The web board's percentiles come from spans, not from the app's Prometheus
histograms. The `http_request_duration_seconds` histogram exists in the app but
nothing records it, so the board does not read it; `ai_inference_duration_seconds`
is the one app histogram the board does use, and it does arrive as an OpenTelemetry
histogram, which New Relic can take percentiles from directly.

That histogram is split into two panels on the `Service` page — `Spark inference
latency` and `Flare inference latency` — each filtering on `model`, instead of one
chart faceting both models. Spark is TF-IDF and Flare is BERT, so their latencies
sit an order of magnitude apart and a shared axis flattens Flare's line.

One counter nuance applies to the web board's app counters. prom-client only
creates a labelled child the first time it is incremented, and New Relic takes
the first value of a cumulative series as its baseline. A counter that is
incremented once and then never again therefore reads `0` forever, because the
single increment is what established the baseline. Counters that keep
incrementing — a cache counter on every hit, a rate-limit counter on every
rejection — lose only their first increment and read correctly afterwards. The
web load rig triggers most of these paths once, which is why they stay empty
there and are expected to populate in prod.

A short scenario adds a second way to miss a counter: the app's metrics only
reach New Relic when the collector scrapes them, and the worker rigs scrape
every 5s. The rate-limit scenario stops at the first refusal, which happens
inside a second, so the counter may never be observed at all. The traces and
logs of the same run are unaffected — those are pushed, not scraped.

## Prod vs dev

| | Prod (`<service>/prod.tftpl`, 8 boards) | Dev twins (`<service>/dev.tftpl`, 5 boards) |
|---|---|---|
| Board JSON | `${account_id}` + `${environment}` templates | only `${account_id}`; `dev` hardcoded in NRQL and titles |
| Data source | the prod stack labels `deployment.environment = 'prod'` | pending — the load rigs still stamp `loadtest`, so the twins stay empty until the rig label switches to `dev` (follow-up) |
| Infra data | CloudWatch (needs account link follow-up) | docker_stats + hostmetrics from the rig |
| Tags | `env = ${var.environment}`, `kind = service-dashboard` or `platform` | `env = dev`, `kind = service-dashboard` |
| Alerts | 7 policies filter `'prod'` -> email | never paged — no dev conditions exist |

## Follow-ups (not in v1)

- Link AWS account (`newrelic_cloud_aws_link_account`) + enable RDS/DocDB/ElastiCache/MQ integrations, then fill CloudWatch panels in `datastores/prod.tftpl`.
- Drop the OTLP collector: services push to New Relic directly
  (`document-parser` is the in-repo reference), and the `pipeline` policy +
  `collector_export_failed` condition lose their data source; boards keep their
  query-shaped panels, which wait for each service's push migration.
- Switch the load rigs' emission label `deployment.environment = loadtest` ->
  `dev` (rig Makefiles/compose env), which is what feeds the dev twins.
- Point the root `Makefile`'s `obs-*` targets at `observability/terraform`.
- When applies leave this workstation (a CI round): an IAM deploy role scoped
  to tfstate handling only — the S3 bucket's create/version plus object
  get/put/delete — and nothing else; until then real-AWS applies stay manual.
- Service SDK gaps: `chat-service`/`chat-worker` emit no traces yet (metrics/logs only); gateway log records carry `trace.id` only once handlers pass a span-bearing context (stdout + OTLP export already wired).
- Workers load rigs need `make load-test WORKER=<name> WITH_OBSERVABILITY=1` plus
  `NEW_RELIC_LICENSE_KEY` in the shell before `workers/dev.tftpl` shows data; the
  default `WITH_OBSERVABILITY=0` stays offline.
- The web load rig works the same way: `make load-test WITH_OBSERVABILITY=1`
  in `apps/web` before `web/dev.tftpl` shows data.
- Browser RUM, Synthetics, SLO objects.
