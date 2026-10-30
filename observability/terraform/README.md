# observability — New Relic monitoring as code

This directory publishes DetectAI's New Relic **dashboards + email alerts** from Terraform:
13 boards, 7 alert policies with 16 conditions, and one email workflow, all in the EU datacenter
(`one.eu.newrelic.com`). It is a separate Terraform root from `infra/terraform` on purpose: a
datastore `destroy` must not take the dashboards with it, and this root stays pure New Relic —
AWS appears only through the state bucket.

## Start here

**[Read the documentation](docs/README.md)** — a quick start, the configuration reference, the
architecture, and one page per dashboard explaining what its charts and alerts mean.

## The 60-second version

```bash
cd observability/terraform

make env                    # create envs/.env (never overwrites) — put a real NRAK- key in it
make fmt init validate test # offline gate: format, validate, mocked tests — no key needed
make check                  # validate the key, preview the plane, resolve the account live
make bootstrap              # create the state bucket for the selected plane
make plan && make apply     # publish to New Relic
```

CI runs the offline gate on every pull request to `main`/`staging` (`.github/workflows/observability.yaml`).
