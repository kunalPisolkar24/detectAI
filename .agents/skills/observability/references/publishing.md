# Publishing to New Relic

## The env file

`make env` copies `envs/.env.example` → `envs/.env` (gitignored, never
overwrites). Keys:

| Key | Required | Default | Feeds |
|---|---|---|---|
| `NEW_RELIC_API_KEY` | yes | — | **User** API key (`NRAK-...`); the ingest license key is rejected |
| `NEW_RELIC_ACCOUNT_ID` | no | `123456` (mock) | target account |
| `NEW_RELIC_REGION` | no | `EU` | datacenter |
| `TF_STATE_BUCKET` | yes on real AWS | `detectai-observability-tfstate` | Terraform state bucket |
| `EMULATOR_ENDPOINT` | no | empty | set → Floci plane; empty → real AWS |
| `AWS_REGION` | no | `ap-south-1` | the **state bucket's** region, not New Relic's |

Precedence: New Relic credentials — a shell export wins for one run; state
keys (`TF_STATE_BUCKET`, `EMULATOR_ENDPOINT`, `AWS_REGION`) — `envs/.env`
wins, a conflicting shell export warns and loses, so a plane stays
reproducible.

`envs/prod.tfvars` pins `newrelic_region = "EU"`; `var.environment` keeps its
`prod` default, which is the label baked into prod-board NRQL, alert
conditions and notification names.

## State planes

| | Floci (`EMULATOR_ENDPOINT` set) | Real AWS (empty) |
|---|---|---|
| Bucket | `detectai-observability-tfstate`, self-heals if missing | required, created versioned |
| Apply | auto-approves | interactive confirm |
| State key | `observability/floci/terraform.tfstate` | `observability/terraform.tfstate` |

Floci needs `make floci-up` from the repo root. `bootstrap` is idempotent and
keyless — the AWS CLI appears only there, for the state bucket.

## Command flow

From `observability/terraform`:

1. `make env` — once per machine.
2. `make fmt init validate test` — the offline gate; CI
   (`.github/workflows/observability.yaml`) runs exactly this on PRs to
   `main`/`staging` and pushes touching `observability/**`.
3. `make check` — `tools/newrelic.py` validates `envs/.env`, previews the
   plane, and resolves the account name over GraphQL, so a valid key from the
   wrong account fails before any plan.
4. `make bootstrap`
5. `make plan && make apply`

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `envs/.env is missing` | no `make env` yet | run it, fill the `NRAK-` key |
| key rejected as ingest-shaped | license key pasted instead of user key | copy the `NRAK-` key from NR *API keys* |
| wrong account resolved | key belongs to another NR account | `make check` fails pre-plan — swap the key |
| state bucket missing on real AWS | no `bootstrap` / wrong `TF_STATE_BUCKET` | `make bootstrap` |
| apply pauses for confirmation | real AWS plane is interactive | confirm, or use the Floci plane for auto-approve |

## CI parity

The offline gate is the PR gate. Live applies are manual — nothing in CI
publishes to New Relic.
