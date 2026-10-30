# Alerts

Layer under `alerts/`: policies in `shared.tf`, conditions in per-area files,
email fan-in in `notifications.tf`.

## Policies

`alerts/shared.tf` maps area → policy (`detectai-<area>-<environment>`,
incident preference `PER_CONDITION`): `web`, `payment_gateway`, `workers`,
`inference`, `document_parser`, `chats`, `pipeline`. Conditions reference
their policy by `newrelic_alert_policy.area["<area>"].id`. What each policy
watches, with thresholds: `docs/services/<area>.md`.

## Conditions (`modules/alert-condition`)

One static NRQL condition per call site. The shared shape is fixed in the
module — 60s `aggregation_window`, `event_flow`, `aggregation_delay = 120` —
do not vary it per condition. Variation lives in the call site:

- `query` — always filters `deployment.environment = '${var.environment}'`
  so load-rig runs never page
- `critical` / `warning` — `{operator, threshold, duration, occurrences}`;
  critical-only is the norm, some pair a warning first (e.g. parser p95
  warns above 2000 ms, critical above 3000 ms; web 5xx share critical
  above 2 % for 300 s)
- optional `fill` — static `fill_value` for sparse series

Per-area files: `web.tf`, `gateway.tf`, `workers.tf`, `inference.tf`,
`parser.tf`, `chats.tf`, `pipeline.tf`.

## Notifications (`alerts/notifications.tf`)

Email only in v1: one destination + channel, one workflow filtering
`labels.policyIds` to every policy in `local.area_policies`, subject
`DetectAI {{accountName}}: {{conditionName}} ({{priority}})`, recipient
`var.alert_email`.

- Adding a condition needs no notification change.
- Adding a policy area means adding it to `local.area_policies` so the
  workflow covers it.

## Tests

`tests/policies.tftest.hcl` (mocked provider) asserts seven policies,
environment-suffixed names (`detectai-web-prod`), and the planned email
workflow. Run `make test` after any alerts change.
