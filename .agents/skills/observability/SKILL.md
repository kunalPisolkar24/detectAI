---
name: Observability
description: DetectAI's New Relic observability — how telemetry flows to New Relic EU and how dashboards and alerts are authored and published as Terraform in observability/terraform. Use when adding or changing boards, panels, NRQL widgets or alerts, wiring or checking service telemetry, streaming load tests to New Relic, or discussing observability.
---

# Observability — New Relic as code

Boards and alerts are Terraform in `observability/terraform/`, a root kept
separate from `infra/terraform` on purpose: destroying a datastore must not
take the boards with it. Everything publishes to the New Relic **EU**
datacenter (`one.eu.newrelic.com`). Current shape: 13 boards (8 prod + 5 dev
twins), 7 alert policies with 17 conditions, one email workflow.

## Map

```text
observability/terraform/
├── main.tf                  wiring only: the two module layers below
├── dashboards/              <name>.tf wiring + <name>/{prod,dev}.tftpl board JSON
├── alerts/                  shared.tf (policies), <area>.tf (conditions), notifications.tf
├── modules/dashboard/       one board + its entity tags
├── modules/alert-condition/ one NRQL condition
├── envs/                    .env (gitignored, from .env.example) + prod.tfvars
├── tools/newrelic.py        credentials brain + terraform driver
├── tests/                   mocked terraform tests — the same gate CI runs
└── docs/                    canonical reference: quickstart, configuration, architecture, per-board tours
```

## How telemetry reaches New Relic

- **Push** — every prod-stack service sends OTLP traces + logs to the
  in-stack `otel-collector`, which forwards everything as OTLP/HTTP to
  `otlp.eu01.nr-data.net:443` with the ingest license key.
- **Scrape** — the same collector polls Prometheus endpoints: web
  `/api/metrics`, workers `:7001-7003`, postgres/redis/rabbitmq exporters.
- **Exception** — `document-parser` ships all three signals directly to EU.
- **Labels** — each collector upserts `deployment.environment`: `prod`/`floci`
  on the prod stack (from its `DEPLOYMENT_ENV`), `loadtest` on load rigs,
  `dev` for stacks run with `ENV_TYPE=dev`. Every NRQL and every alert filters
  on this label, so rig runs never page anyone.
- **Fail-open** — an empty `NEW_RELIC_LICENSE_KEY` makes the collector retry
  and drop; apps keep serving. Telemetry never fails a run.

Details and per-service endpoints: [references/telemetry-pipeline.md](references/telemetry-pipeline.md)

## Add or change dashboard panels

1. Edit **both** templates of the board: `dashboards/<name>/prod.tftpl` and
   `<name>/dev.tftpl`. The dev twin mirrors prod panel-for-panel — `make test`
   fails on any drift.
2. Every query filters `deployment.environment = '${environment}'` (prod) or
   `= 'dev'` (dev twin) plus `service.name = '<service>'`, and carries
   `"accountId": "${account_id}"`.
3. Layout: tables span the full 12 columns; charts pair side by side at width
   6; gauge rows go four-up at width 3.
4. Verify offline from `observability/terraform`:
   `make fmt init validate test` — no key, no network.
5. Publish (below).

Board JSON format and widget cookbook: [references/dashboards.md](references/dashboards.md)

## Add a board

1. Write `dashboards/<name>/prod.tftpl` (+ `dev.tftpl` for services with local
   dev stacks) and wire it in `dashboards/<name>.tf`, following
   `dashboards/web.tf`: a `modules/dashboard` call per board + entity tags via
   `scope`/`kind`/`env`.
2. Update `tests/dashboards.tftest.hcl`: the board-count assertion (13 today)
   and the twin-parity lists.
3. Add a tour at `docs/services/<name>.md`, run the offline gate, publish.

## Add an alert

1. Add a `modules/alert-condition` call in `alerts/<area>.tf`; the policy id
   comes from `newrelic_alert_policy.area["<area>"].id` (map in
   `alerts/shared.tf`).
2. Filter `deployment.environment = '${var.environment}'` — always, so rig
   runs never page.
3. Windowing is shared (60s windows, `event_flow`, 120s delay); vary only the
   query and thresholds. Email routing needs no change: the workflow fans
   every policy to one inbox.

Anatomy, thresholds, notifications: [references/alerts.md](references/alerts.md)

## Publish to New Relic

```bash
cd observability/terraform        # never the root Makefile's obs-* targets
make env                          # creates envs/.env — put a real NRAK- key in it
make fmt init validate test       # offline gate — exactly what CI runs
make check                        # validates .env, previews the plane, resolves the account live
make bootstrap                    # state bucket for the selected plane (no key needed)
make plan && make apply           # auto-approves on Floci, interactive on real AWS
```

`NEW_RELIC_API_KEY` must be a **User** key (`NRAK-...`) — the ingest license
key is rejected. Secrets live only in `envs/.env` or the shell, never
committed.

Planes, precedence, failure modes: [references/publishing.md](references/publishing.md)

## Guardrails

- Run everything from `observability/terraform`. The root `Makefile`'s
  `obs-*` targets point at a removed `infra/observability` path — dead today.
- This root is pure New Relic: no AWS provider, and no edits reaching into
  `infra/terraform` or service code from here.
- A widget is only as real as its telemetry: confirm the span/metric/log
  attribute actually flows before charting it (see the telemetry reference).
- The offline gate is the PR gate — never leave it failing.
