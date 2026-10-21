# infra/observability — DetectAI New Relic observability (Terraform)

Publishes **New Relic dashboards + email alerts** as code. EU region (`one.eu.newrelic.com`,
OTLP `https://otlp.eu01.nr-data.net:443`). Separate Terraform root from
`infra/terraform` on purpose: dashboards must survive datastore `destroy`, and this
root has no AWS provider / emulator hacks.

## Layout

- `versions.tf`, `providers.tf` — `newrelic ~> 3.0`, `region = EU`. No `aws` provider.
- `variables.tf` — `newrelic_account_id` (6428768), `newrelic_api_key` (sensitive,
  env only), `newrelic_region` (EU), `alert_email`.
- `main.tf` — 13 `newrelic_one_dashboard_json` resources from `dashboards/*.json`
  via `templatefile` (`${account_id}`). Two statuses only: the nine prod boards
  filter `deployment.environment = 'prod'`, and the four `-loadtest` boards hardcode
  `deployment.environment = 'loadtest'` so k6 runs never pollute prod boards.
- `dashboards/` — `overview`, `web`, `web-loadtest`, `payment-gateway`,
  `payment-gateway-loadtest`, `workers`, `workers-loadtest`, `inference`,
  `document-parser`, `document-parser-loadtest`, `chats`, `chats-loadtest`,
  `datastores`. Every prod NRQL filters `deployment.environment = 'prod'`.
- `dashboards/web.json` — one board for the Next.js frontend and BFF
  (`service.name = web`). Pages: `Overview` (request rate, error share, p95,
  Apdex, container CPU/heap), `Service` (RED per route, status split,
  downstream dependency latency and errors, auth failures, AI inference
  latency, rate-limit and cache counters), `Service Logs` (error stream, log
  volume by level, errors by message, recent errors, slow requests) and
  `Infra` (DB query percentiles, cache behaviour, Node runtime, and the
  Postgres / Redis / RabbitMQ exporter panels). `web-loadtest.json` is
  page-for-page identical with `'loadtest'` hardcoded and ` (load)` appended to
  the panel titles, like the chats pair.
- Log pages share one layout across every board: the tables are full width
  (a log message needs the columns) and the two chart panels sit side by side
  at half width.
- `dashboards/workers.json` — one board for all three worker deployables
  (`worker-analytics`, `worker-cron`, `worker-payments`), each its own binary,
  container and `service.name`. Pages: `Overview` (cross-worker rollup: throughput,
  errors, broker/cache connectivity, DLQ, cron expiry lag), `Analytics`,
  `Analytics Logs`, `Cron`, `Cron Logs`, `Payments`, `Payments Logs`, `Infra`.
  Follows the `chats-loadtest` precedent (multiple `service.name`s, one board, one
  page each) rather than a board per worker. Rates and counts come from
  `FROM Metric` (exact); percentiles come from spans (sampling shifts counts, not
  percentiles). Each worker page also carries that worker's own container
  resources via `docker_stats` with an exact `container.name = 'worker_<name>'`
  filter (prod stacks and load rigs name the containers the same), plus its
  eventloop lag, heap and message size. `Infra` covers the four datastores the
  workers depend on, gauges first, then one row per store, then tables: Postgres
  (`db_pool_connections` states, sweep transaction duration, DB-down requeues,
  sweep skips, plus the `postgres-exporter` backends/locks/longest transaction),
  Redis users + events (`redis_connection_status` per `client_name`, exporter
  memory/evictions/keyspace/clients) and RabbitMQ (app-side reconnects, consume
  duration percentiles, dead-letter log rate, plus broker-side queue depth and
  consumers). Worker-side widgets filter `service LIKE 'worker-%'`, so the
  `payment-gateway` copy of `rabbitmq_connection_status` never leaks in;
  exporter widgets facet on `service.name` (`redis-users`, `redis-events`).
  `workers-loadtest.json` is page-for-page identical with `'loadtest'`
  hardcoded, except for the one panel that only one environment can fill:
  `Paddle API latency and cancels` needs a real call to Paddle's API, which
  only a user-initiated cancellation makes, so the prod board keeps it and the
  loadtest board shows `Cancel events/min` (the rig's cancel path) instead.
- `alerts.tf` — one policy per area, NRQL static conditions, all enabled and
  filtering `deployment.environment = 'prod'` so loadtest runs never page. Workers
  policy: `workers_error_rate` (all three via `service.name LIKE 'worker-%'`),
  `cron_expiry_lag` (gauge-driven, not tick counts), `workers_dead_letter_growth`,
  `workers_broker_disconnected`.
- `notifications.tf` — email destination + channel + workflow only.
- `envs/prod.tfvars` — non-secret values only. Keys via
  `TF_VAR_newrelic_api_key` or `NEW_RELIC_API_KEY` env.
- `tests/valid.tftest.hcl` — mocked plan asserts 13 dashboards (plus the workers
  board page count and the web board page count), the chats prod board's pages
  and panels against the chats loadtest board, the same twin check for the web
  boards, and prod policy names.

## Worker log export

Worker logs reach New Relic only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set;
otherwise the workers print JSON to stdout and no `FROM Log` widget has data.
Console output is unchanged either way — `Logger` writes to stdout and forwards to
an OTLP sink that is a no-op when the endpoint is unset, so a failing exporter
never blocks a worker. `shared/logging/sink.ts` holds the sink contract, and
`shared/logging/redact.ts` the masking, so neither depends on the `Logger` module
that unit tests replace wholesale.
- `tags.tf` — `newrelic_entity_tags` per board (`team`, `managed-by`,
  `service`, `env`, `kind`) so boards group instead of listing flat. Prod boards
  tag `env=prod`; the loadtest boards always tag `env=loadtest`.

## Data flow

Apps (`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`) ->
`otel-collector` in `infra/docker/prod/compose.yml` (prod stack only) ->
OTLP/HTTP to EU with `NEW_RELIC_LICENSE_KEY` (ingest key, from gitignored
`infra/docker/prod/.env`, never committed). Floci infra panels use exporter
sidecars (`profiles: [floci]`); prod infra panels use CloudWatch after the AWS
account link (see `dashboards/datastores.json` note).

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
stdout.

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

## Usage

```bash
cd infra/observability
export NEW_RELIC_API_KEY="NRAK-..."   # user key, never commit

terraform init -backend=false
terraform fmt -check -recursive -diff
terraform validate
terraform test                                   # mocked, no network
terraform plan -var-file=envs/prod.tfvars

# stateful (current state lives in the local emulator S3 bucket):
terraform init -reconfigure -backend-config=backend.local-s3.hcl
terraform apply -var-file=envs/prod.tfvars

# later, when moving state to real S3:
cp backend.prod.hcl.example backend.prod.hcl    # fill bucket, never commit
terraform init -migrate-state -backend-config=backend.prod.hcl
```

From repo root:

```bash
make obs-fmt obs-validate
make obs-plan
make obs-apply
```

## Prod vs loadtest

| | Prod (`(prod)` boards) | Loadtest rigs (`(loadtest)` boards) |
|---|---|---|
| App data | collector -> EU with `prod` label | rig collector -> EU with `loadtest` label |
| Infra data | CloudWatch (needs account link follow-up) | docker_stats + hostmetrics from the rig |
| Alerts | conditions filter `deployment.environment = 'prod'` -> email | excluded by the prod filter |

## Follow-ups (not in v1)

- Link AWS account (`newrelic_cloud_aws_link_account`) + enable RDS/DocDB/ElastiCache/MQ integrations, then fill CloudWatch panels in `datastores.json`.
- Service SDK gaps: `chat-service`/`chat-worker` emit no traces yet (metrics/logs only); gateway log records carry `trace.id` only once handlers pass a span-bearing context (stdout + OTLP export already wired).
- Workers load rigs need `make load-test WORKER=<name> WITH_OBSERVABILITY=1` plus
  `NEW_RELIC_LICENSE_KEY` in the shell before `workers-loadtest.json` shows data; the
  default `WITH_OBSERVABILITY=0` stays offline.
- The web load rig works the same way: `make load-test WITH_OBSERVABILITY=1`
  in `apps/web` before `web-loadtest.json` shows data.
- Browser RUM, Synthetics, SLO objects.
