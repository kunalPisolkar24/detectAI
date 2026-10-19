# infra/observability — DetectAI New Relic observability (Terraform)

Publishes **New Relic dashboards + email alerts** as code. EU region (`one.eu.newrelic.com`,
OTLP `https://otlp.eu01.nr-data.net:443`). Separate Terraform root from
`infra/terraform` on purpose: dashboards must survive datastore `destroy`, and this
root has no AWS provider / emulator hacks.

## Layout

- `versions.tf`, `providers.tf` — `newrelic ~> 3.0`, `region = EU`. No `aws` provider.
- `variables.tf` — `newrelic_account_id` (6428768), `newrelic_api_key` (sensitive,
  env only), `newrelic_region` (EU), `alert_email`.
- `main.tf` — 12 `newrelic_one_dashboard_json` resources from `dashboards/*.json`
  via `templatefile` (`${account_id}`). Two statuses only: the eight prod boards
  filter `deployment.environment = 'prod'`, and the four `-loadtest` boards hardcode
  `deployment.environment = 'loadtest'` so k6 runs never pollute prod boards.
- `dashboards/` — `overview`, `web`, `payment-gateway`, `payment-gateway-loadtest`,
  `workers`, `workers-loadtest`, `inference`, `document-parser`,
  `document-parser-loadtest`, `chats`, `chats-loadtest`, `datastores`. Every prod
  NRQL filters `deployment.environment = 'prod'`.
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
  eventloop lag, heap and message size. `Infra` is datastore-only: RabbitMQ /
  Redis users / Redis events / Postgres container stats matched with
  `container.name LIKE '%rabbitmq%'`, `'%redis-users%'`, `'%redis-events%'`,
  `'%postgres-users%'`, per-store `redis_connection_status` connectivity
  (faceted by `client_name`), and the Postgres `db_pool_connections` pool
  states. `workers-loadtest.json` is page-for-page identical with `'loadtest'`
  hardcoded.
- `alerts.tf` — one policy per area, NRQL static conditions, all enabled and
  filtering `deployment.environment = 'prod'` so loadtest runs never page. Workers
  policy: `workers_error_rate` (all three via `service.name LIKE 'worker-%'`),
  `cron_expiry_lag` (gauge-driven, not tick counts), `workers_dead_letter_growth`,
  `workers_broker_disconnected`.
- `notifications.tf` — email destination + channel + workflow only.
- `envs/prod.tfvars` — non-secret values only. Keys via
  `TF_VAR_newrelic_api_key` or `NEW_RELIC_API_KEY` env.
- `tests/valid.tftest.hcl` — mocked plan asserts 12 dashboards (plus the workers
  board page count) and prod policy names.

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
- Browser RUM, Synthetics, SLO objects.
