# Publishing to New Relic

## The env file

`make env` copies `envs/.env.example` → `envs/.env` (gitignored, never
overwrites). Keys:

| Key | Required | Default | Feeds |
|---|---|---|---|
| `NEW_RELIC_API_KEY` | yes | — | **User** API key (`NRAK-...`); the ingest license key is rejected |
| `NEW_RELIC_ACCOUNT_ID` | no | `123456` (mock) | target account |
| `NEW_RELIC_REGION` | no | `EU` | datacenter |
| `AWS_REGION` | no | `ap-southeast-2` | the **state bucket's** region, not New Relic's |

Precedence: a shell export of `NEW_RELIC_API_KEY` wins for one run —
everything else is plain file content, shape-checked.

The plane itself never comes from this file: `--aws` rides real AWS, floci is
the default (`make ... PLANE=floci|aws`).

`var.newrelic_region` keeps its `EU` default in the HCL and `var.environment`
keeps its `prod` default, which is the label baked into prod-board NRQL,
alert conditions and notification names.

## State planes

| | Floci (default) | Real AWS (`PLANE=aws`) |
|---|---|---|
| Bucket | `detectai-observability-tfstate-000000000000`, self-heals if missing | `detectai-observability-tfstate-<your account>`, created versioned |
| Apply | auto-approves | interactive confirm |
| State key | `observability/floci/terraform.tfstate` | `observability/terraform.tfstate` |
| Run identity | the emulator's fake credentials | the `detectai-observability-seeder` role (created on demand, MFA-gated, cached 12 h) |

Floci needs `make floci-up` from the repo root; the real-plane MFA
device is derived from your IAM user, with no override.
`PLANE=floci|aws` (default floci) selects the plane on any make
target.

## Command flow

From `observability`:

1. `make env` — once per machine.
2. `make fmt init validate test` — the offline gate; CI
   (`.github/workflows/observability.yaml`) runs exactly this on PRs to
   `main`/`staging` and pushes touching `observability/**`.
3. `make check` — tfctl validates `envs/.env`, previews the plane, and
   resolves the account name over GraphQL, so a valid key from the wrong
   account fails before any plan.
4. `make plan && make apply` — the plane's state bucket is
   created on demand on the first run

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `envs/.env is missing` | no `make env` yet | run it, fill the `NRAK-` key |
| key rejected as ingest-shaped | license key pasted instead of user key | copy the `NRAK-` key from NR *API keys* |
| wrong account resolved | key belongs to another NR account | `make check` fails pre-plan — swap the key |
| state bucket missing on real AWS | it self-heals; only a stale or wrong-region creds issue blocks it | rerun — the next plan/apply creates `detectai-observability-tfstate-<your account>` versioned on demand |
| apply pauses for confirmation | real AWS plane is interactive | confirm, or use the Floci plane for auto-approve |

## CI parity

The offline gate is the PR gate. Live applies are manual — nothing in CI
publishes to New Relic.
