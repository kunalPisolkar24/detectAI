# infra/observability — DetectAI New Relic observability (Terraform)

Publishes **New Relic dashboards + email alerts** as code. EU region (`one.eu.newrelic.com`,
OTLP `https://otlp.eu01.nr-data.net:4317`). Separate Terraform root from
`infra/terraform` on purpose: dashboards must survive datastore `destroy`, and this
root has no AWS provider / emulator hacks.

## Layout

- `versions.tf`, `providers.tf` — `newrelic ~> 3.0`, `region = EU`. No `aws` provider.
- `variables.tf` — `newrelic_account_id` (6428768), `newrelic_api_key` (sensitive,
  env only), `newrelic_region` (EU), `environment` (`prod|floci`), `alert_email`.
- `main.tf` — 11 `newrelic_one_dashboard_json` resources from `dashboards/*.json`
  via `templatefile` (`${account_id}`, `${environment}`). `document-parser-loadtest`
  is environment-agnostic (hardcoded `deployment.environment = 'loadtest'`) and
  ships with both envs so k6 runs never pollute prod boards.
- `dashboards/` — `overview`, `web`, `payment-gateway`, `worker-analytics`,
  `worker-payments`, `worker-cron`, `inference`, `document-parser`,
  `document-parser-loadtest`, `chats`, `datastores`. Every prod NRQL filters `deployment.environment`.
- `alerts.tf` — one policy per area, NRQL static conditions. Criticals are
  `enabled = environment == prod` so Floci test data never sends mail.
- `notifications.tf` — email destination + channel + workflow only.
- `envs/floci.tfvars|prod.tfvars` — non-secret values only. Keys via
  `TF_VAR_newrelic_api_key` or `NEW_RELIC_API_KEY` env.
- `tests/valid.tftest.hcl` — mocked plan asserts 11 dashboards + channel.
- `tags.tf` — `newrelic_entity_tags` per board (`team`, `managed-by`,
  `service`, `env`, `kind`) so boards group instead of listing flat. The
  loadtest board always tags `env=loadtest`.

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
terraform plan -var-file=envs/floci.tfvars      # test render
terraform plan -var-file=envs/prod.tfvars       # real publish dry-run

# stateful (optional, mirrors infra/terraform):
terraform init -reconfigure -backend-config=backend.local-s3.hcl
terraform apply -var-file=envs/floci.tfvars
cp backend.prod.hcl.example backend.prod.hcl    # fill bucket, never commit
terraform init -reconfigure -backend-config=backend.prod.hcl
terraform apply -var-file=envs/prod.tfvars
```

From repo root (after Makefile targets land):

```bash
make obs-fmt obs-validate
make obs-plan ENV=floci
make obs-apply ENV=prod CONFIRM_PROD=1
```

## Floci vs prod

| | Floci (`ENV=floci`) | Prod (`ENV=prod`) |
|---|---|---|
| Dashboards render | yes (`(floci)` titles) | yes (`(prod)` titles) |
| App data | collector -> EU with `floci` label | collector -> EU with `prod` label |
| Infra data | exporter sidecars | CloudWatch (needs account link follow-up) |
| Alerts | warnings enabled, criticals disabled | all enabled -> email |

## Follow-ups (not in v1)

- Link AWS account (`newrelic_cloud_aws_link_account`) + enable RDS/DocDB/ElastiCache/MQ integrations, then fill CloudWatch panels in `datastores.json`.
- Service SDK gaps: `chat-service`/`chat-worker` emit no traces yet (metrics/logs only); Go gateway ignores `OTEL_RESOURCE_ATTRIBUTES` — needs `resource.WithFromEnv` merge.
- Browser RUM, Synthetics, SLO objects.
