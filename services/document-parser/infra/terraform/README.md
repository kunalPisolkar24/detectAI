# document-parser — App-Side AWS: Secrets, Config, and IAM

Provisions this service's app-side slice of AWS as three contracts, all pinned
to the `detectai/document-parser/` naming:

1. **Secrets blob** — `detectai/document-parser/secrets`, seeded with the API
   key as JSON `{"API_KEY": "..."}`; consumers pull the whole blob at boot and
   read keys by name, so adding keys later is a terraform-only change with no
   consumer-side schema migration.
2. **Config parameters** — non-secret runtime config from `.env`, seeded under
   SSM paths `/detectai/document-parser/<KEY>` (type String). The seed
   allowlist lives in `tools/secrets.py` (`SSM_SEED_KEYS`); absent or empty
   `.env` keys seed nothing, and everything env-provided in dev stays
   env-provided in prod. Terraform is compose-free for secrets on purpose.
3. **Runtime IAM role** — `detectai-document-parser`, the service's read
   identity: `GetSecretValue/DescribeSecret` on the blob and
   `GetParameter*` on the config prefix, nothing else. No S3 — the app is
   stateless (requirements.md NFR-1); the state bucket is deploy-tooling
   territory. Trust is in-account (`sts:AssumeRole` with a root principal)
   and gains a concrete host principal (ECS/EC2/EKS) when the runtime host
   materializes.

The stack does not deploy the app; the app runs via `infra/compose.yml`. This
stack manages the credential store, the config parameters, and the runtime
role only.

## Planes

One stack, two destinations, flipped by `EMULATOR_ENDPOINT` in `infra/.env`:

|                     | Emulator (Floci/LocalStack)       | Real AWS                       |
|---------------------|-----------------------------------|--------------------------------|
| Selected by         | `EMULATOR_ENDPOINT` set           | line empty or removed          |
| Credentials         | dummy `test`/`test`               | real AWS keys                  |
| State bucket        | `TF_STATE_BUCKET` or default `detectai-docparser-tfstate` | `TF_STATE_BUCKET` (required)  |
| Secret deletion     | instant (0-day recovery window)   | 30-day recovery window         |
| Apply               | auto-approved                     | interactive confirm            |

The provider block adapts (`providers.tf`): the emulator plane gets `test`
credentials, `skip_*` flags, and endpoint overrides (`secretsmanager`, `ssm`,
`iam`, `sts`); the real-AWS plane leaves all of those unset. IAM policy ARNs
need a 12-digit account id: real AWS resolves it via a caller-identity data
source; the emulator pins it via `aws_account_id` (default `000000000000`,
settable through `TF_VAR_aws_account_id`).

## IAM identities

Two roles, one per plane of responsibility:

| Role | Created by | Trust | Can do |
|------|------------|-------|--------|
| `detectai-document-parser` (runtime, in-stack) | terraform on both planes | in-account `sts:AssumeRole` (root principal, no service principal yet) | `secretsmanager:GetSecretValue/DescribeSecret` on the blob; `ssm:GetParameter(s)(ByPath)` on the config prefix — nothing else |
| `detectai-document-parser-deploy` (deploy, out-of-stack) | `make secrets-iam-bootstrap` (one-time CLI) | your IAM user + MFA | terraform's workload for this service only: state-bucket lifecycle (`RunTerraformStateBucket/Objects`), secret write/read (`ManageServiceSecret`), SSM write/read (`ManageServiceConfig`), and administering the runtime role (`ManageRuntimeRole`) |

The runtime role is inline-policy-scoped (`modules/document-parser/iam.tf`), so
the deploy role never needs managed-policy churn or `PassRole` — and nothing
here creates deployment resources. The deploy role is deliberately out-of-stack
so terraform never manages its own identity; the first-ever apply (which creates
the roles' own ledger) still happens under your current credentials.

Emulator-plane caveats: Floci accepts the calls but never enforces IAM policies,
so `terraform plan/apply` there proves structure; enforcement bites on real AWS.

## State config

There are no `backend.*.hcl` files in this stack. `tools/secrets.py` composes the
backend config (bucket, key, region, per-plane flags, and on the emulator the
`s3` endpoint — the same value as `EMULATOR_ENDPOINT`, never a second source of
truth), writes it to a temp file, and feeds `terraform init -reconfigure -backend-config <file>`.
`backend.example.hcl` documents the shapes for manual, scriptless runs; the script
never reads it.

State expectations:
- the state *key* is fixed per plane (`document-parser/floci/terraform.tfstate` vs
  `document-parser/terraform.tfstate`); the state *bucket* is per engineer/tester on
  both planes — one sandbox bucket each, so parallel testing never collides or
  cross-contaminates state. On the emulator an unset `TF_STATE_BUCKET` falls back to
  the fixed local default; on real AWS it is required.
- changing `TF_STATE_BUCKET` (or the region) after a first apply points Terraform at
  a new/empty ledger: `plan` will offer to create everything again; nothing migrates,
  and the old bucket keeps its old state files until you delete it.
- the emulator's S3/Secrets data is in-memory (only setup views persist to its
  volume): a container restart can drop everything. Recovery is cheap — any
  terraform verb now recreates the missing bucket itself
  (`ensure_state_bucket`), so a bare `make secrets-apply` rebuilds the plane;
  `make secrets-bootstrap-state && make secrets-apply` stays equivalent.
- never run bare `terraform init` — the stacked backend is intentionally partial and
  only the script supplies it.
- the real-AWS plane needs Terraform >= 1.10 for the `use_lockfile` backend flag.

## Data flow

`infra/.env` → `tools/secrets.py` (parse → validate → `TF_VAR_*`, including
`TF_VAR_ssm_parameters` for the allowlisted non-secret config) → terraform →
AWS. Terraform never reads `.env`. The Python tool's direct AWS steps are the
opt-in bucket bootstrap (`make secrets-bootstrap-state`), the opt-in deploy
role bootstrap (`make secrets-iam-bootstrap`), and the destroy-time wipe —
all via the `aws` CLI. Validation repeats by design at three layers
(defense-in-depth, not duplication): `tools/secrets.py` checks human input
before terraform runs, root `variables.tf` protects the stack, and
`modules/document-parser/variables.tf` protects the contract for any caller.

## Quick start

```bash
cd services/document-parser
make env             # create infra/.env from the example; set a real API_KEY
make secrets-check   # validate .env, preview plane and vars (no terraform)
make secrets-plan    # plan against the plane .env selects
make secrets-apply   # apply (auto on Floci, interactive on real AWS)
```

The state bucket must exist before the first `init` — one command for whichever
plane `.env` selects (idempotent; verified-account or emulator):

```bash
make secrets-bootstrap-state
```

Manual equivalent, for reference. Emulator (bucket name: `TF_STATE_BUCKET` or, if
unset, the default `detectai-docparser-tfstate`):

```bash
aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-docparser-tfstate --region ap-southeast-2
```

Real AWS requires `TF_STATE_BUCKET=<bucket>` in `infra/.env` — a sandbox bucket per
engineer/tester (versioned, encrypted, private; bootstrap enables versioning, SSE
defaults to on; Terraform >= 1.10 for `use_lockfile`):

```bash
aws s3 mb s3://<bucket> --region ap-southeast-2
aws s3api put-bucket-versioning --bucket <bucket> --versioning-configuration Status=Enabled --region ap-southeast-2
```

## Teardown

| Command                | Removes                                                                                               | Keeps                   |
|------------------------|-------------------------------------------------------------------------------------------------------|-------------------------|
| `make secrets-clean`   | the secret + version, the SSM config parameters, the runtime role (terraform destroy)                  | state bucket, ledger, deploy role |
| `make secrets-destroy` | everything in `secrets-clean` **plus** every object version and the state bucket (purge) **and** the out-of-stack deploy role (`--drop-iam`) | nothing |

`make secrets-destroy` is the true full wipe: terraform destroy runs first, then
the purge wipe removes the state bucket, and only then does `--drop-iam` detach
`deploy-policy` and delete `detectai-document-parser-deploy` (typed barrier on
real AWS, unattended on the emulator). A missing deploy role is a no-op, so the
step is safe to repeat. To bring the deploy identity back without re-bootstrapping
anything: `make secrets-iam-bootstrap` recreates it (idempotent).

Both verbs share the apply pipeline: same `.env` validation, same backend
config, `--dry-run` prints everything first, and the emulator plane
auto-approves where real AWS keeps its interactive confirmations.

- `terraform destroy` never deletes the S3 state bucket — it is backend
  storage, not a stack resource. Only `--purge-state` touches it, and only
  after destroy succeeded (the ledger must not be needed again).
- On real AWS, `secrets-destroy` asks for the bucket name as a typed barrier
  before any destruction; a refusal cancels everything. It also warns when the
  listing shows objects outside `document-parser/` — deleting the bucket wipes
  sibling stacks' state in a shared sandbox too.
- Destroying on real AWS schedules the secret with the 30-day recovery window.
  To skip it add `--force-delete`:
  `poetry run python tools/secrets.py destroy --force-delete`.
- After `secrets-clean`, re-apply is just `make secrets-apply` again — init
  reuses the kept ledger, which now holds an empty state.

## Testing

`terraform test` — `tests/document-parser.tftest.hcl`, mocked AWS provider, no
emulator or AWS needed: the contract name is the output, the emulator plane keeps a
0-day recovery window, the prod plane keeps 30 days, the runtime role keeps its
service-scoped name, and the SSM seeding only follows the
`/detectai/document-parser/` prefix (an unset map seeds nothing).

## Hygiene

- `api_key` is `sensitive`; the driver prints only its length.
- The state file stores `secret_string` in plaintext — the prod state bucket must be
  versioned, encrypted, and access-restricted (see `backend.example.hcl`).
