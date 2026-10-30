# Telemetry pipeline

How app data reaches New Relic EU, and what labels it.

## Prod stack

One collector per stack (`infra/docker/prod/otel-collector-config.yaml`, run
from `infra/docker/prod/compose.yml`):

| Signal | Path |
|---|---|
| Traces + logs | services → OTLP `http://otel-collector:4318` → collector → `otlp.eu01.nr-data.net:443` |
| Metrics | collector scrapes Prometheus endpoints and forwards them in the same stream |
| document-parser | direct OTLP to EU — the reference pattern for dropping the collector |

Scraped endpoints: web `/api/metrics`, workers `:7001-7003`, and the
postgres/redis/rabbitmq exporters.

- Export auth: `NEW_RELIC_LICENSE_KEY` (ingest key, eu01).
  `NEW_RELIC_OTLP_ENDPOINT` overrides the endpoint; keep `:443` — port 4318
  is blocked on this egress path.
- Labeling: the collector upserts `deployment.environment` from
  `DEPLOYMENT_ENV` (`${ENV_TYPE:-prod}` in compose). Apps also carry
  `OTEL_RESOURCE_ATTRIBUTES=deployment.environment=${ENV_TYPE:-prod}`.
- Noise control: the collector drops health/metrics spans (filter list in the
  config).
- Empty license key → exporter fails closed with retry; apps keep serving.

## Labels — who sees what

| `deployment.environment` | Producer | Visible on |
|---|---|---|
| `prod` | prod stack (`ENV_TYPE=prod`) | prod boards + alerts |
| `floci` | floci stack (collector gets `DEPLOYMENT_ENV=floci`) | prod boards + alerts |
| `dev` | stacks run with `ENV_TYPE=dev` | dev twin boards |
| `loadtest` | load rigs (`WITH_OBSERVABILITY=1`) | nothing — ad-hoc NRQL only |

Alerts always filter `${var.environment}` (`prod`/`floci`), so a load run can
never page. Rig data still lands in NR; investigate with raw NRQL.

## Load-test telemetry (opt-in)

`make load-test ... WITH_OBSERVABILITY=1` from a component dir adds:

- `infra/docker/otel/loadtest-observability.yml` — the shared
  `otel-collector-loadtest` atom; its config upserts
  `deployment.environment=loadtest` and exports to EU on `:443`.
- A component overlay that wires the collector and exporters onto the load
  project: `apps/web/infra/compose.load.observability.yml`,
  `services/payments/gateway/infra/compose.load.observability.yml`,
  `services/chats/infra/compose.load.observability.yml`,
  `services/workers/infra/compose.load.observability.yml` (worker-agnostic;
  adds redis/postgres exporters, the rabbitmq exporter rides
  `compose.load.rabbitmq.yml`).

Needs `NEW_RELIC_LICENSE_KEY` in the shell (never committed). Remote mode
(`REMOTE=1`) ignores the flag: the target stack already exports its own
telemetry.

## Checking that a metric exists

New widgets need telemetry that already flows. Before charting an attribute:

1. Confirm the service emits it — check the service's compose env pass-through
   (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`,
   `OTEL_RESOURCE_ATTRIBUTES`) and its metrics code.
2. Confirm the collector doesn't drop it (span filters above).
3. Query it in New Relic (data query / NRQL) under the right
   `deployment.environment` before adding a panel.
