# Dashboards (board layer)

One wiring file per board in `dashboards/`, each backed by JSON templates.
`modules/dashboard` wraps `newrelic_one_dashboard_json` + `newrelic_entity_tags`
(tags: `team=detectai`, `managed-by=terraform`, `service`, `env`, `kind`).

Boards: prod set is `overview`, `datastores`, `web`, `payment-gateway`,
`workers`, `inference`, `document-parser`, `chats`; dev twins exist for web,
payment-gateway, workers, document-parser, chats (`overview`/`datastores`/
`inference` have none — rigs never run the AI service). What each board shows:
`docs/services/<name>.md`.

## Wiring pattern (`dashboards/web.tf`)

```hcl
module "web" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/web/prod.tftpl", {
    account_id  = var.account_id
    environment = var.environment
  })
  scope = "web"
  kind  = "service-dashboard"
  env   = var.environment
}
```

The twin (`web_dev`) points at `web/dev.tftpl` — which takes only
`account_id`, because `dev` is hardcoded in the JSON — and sets `env = "dev"`.

## Template format

Board JSON: `name`, `description`, `permissions` (`PUBLIC_READ_WRITE`),
`pages[]`, each page `widgets[]`. A widget: `title`, `layout`
(`column`/`row`/`width`/`height`), `visualization.id`, `rawConfiguration`
whose `nrqlQueries[]` are `{accountId: "${account_id}", query}`.

Visualizations in use: `viz.area`, `viz.bar`, `viz.billboard`, `viz.gauge`,
`viz.line`, `viz.markdown`, `viz.stacked-bar`, `viz.table`. Gauges and
billboards take optional `rawConfiguration.thresholds` (`warning`/`alert`
values) for color bands.

Layout conventions (asserted for web; followed everywhere):
- tables span the full 12 columns
- charts pair side by side at width 6; gauge rows go four-up at width 3
- rows step 3 units (charts/gauges) or 4 (log tables)

## NRQL conventions

- Golden signals from server spans:
  `FROM Span ... WHERE span.kind = 'server'` with
  `rate(count(*), 1 minute)`, `percentage(count(*), WHERE error = true)`,
  `percentile(duration.ms, 50, 95, 99)`.
- Custom counters: `FROM Metric SELECT rate(sum(<name>_total), 1 minute)`
  faceted by the label the code sets (e.g. `FACET status`, `FACET stage`).
- Infra gauges: `FROM Metric SELECT average(...)` on exporter metrics
  (`pg_*`, `redis_*`, `rabbitmq_*`, `nodejs_*`, `container.*`).
- Logs: `FROM Log` filtered on `` `severity.text` `` (backticked).
- One concern per panel: the Spark/Flare inference charts are separate
  because a shared axis hid Flare's latency.

## Dev twins and the tests

Dev twins hardcode `deployment.environment = 'dev'` and mirror prod
panel-for-panel, titles suffixed ` (dev)`. `tests/dashboards.tftest.hcl`
(mocked provider) asserts:

- the total board count
- twin parity: same pages, same panel counts, same panel coverage
- exact title order for web/payment-gateway/chats; workers may swap prod's
  "Paddle API latency and cancels" for the rig's "Cancel events/min" on its
  Payments page
- layout invariants (full-width tables, side-by-side chart pairs)

So: change panels on both sides or the gate fails, and a deliberate
deviation needs a new assertion documenting it (see the workers Payments
swap).
