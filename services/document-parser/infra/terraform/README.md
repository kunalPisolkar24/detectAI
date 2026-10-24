# document-parser — Secrets Terraform Stack

Provisions one thing: the Secrets Manager secret `detectai/document-parser/secrets`
(infrastructure `main.tf` holds the blob shape), seeded with the service API key as a
JSON blob: `{"API_KEY": "..."}`. The blob is the contract — consumers pull the whole
secret at boot and read keys by name, so adding keys later is a terraform-only change
with no consumer-side schema migration.

The stack does not deploy the app; the app runs via `infra/compose.yml`. This stack
manages the credential store only.

## Planes

One stack, two destinations, flipped by `EMULATOR_ENDPOINT` in `infra/.env`:

|                     | Emulator (Floci/LocalStack)       | Real AWS                       |
|---------------------|-----------------------------------|--------------------------------|
| Selected by         | `EMULATOR_ENDPOINT` set           | line empty or removed          |
| Credentials         | dummy `test`/`test`               | real AWS keys                  |
| State bucket        | `TF_STATE_BUCKET` or default `detectai-tfstate-local` | `TF_STATE_BUCKET` (required)  |
| Secret deletion     | instant (0-day recovery window)   | 30-day recovery window         |
| Apply               | auto-approved                     | interactive confirm            |

The provider block adapts (`providers.tf`): the emulator plane gets `test`
credentials, `skip_*` flags, and a `secretsmanager` endpoint override; the real-AWS
plane leaves all of those unset.

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
  volume): a container restart can drop everything. Recovery is cheap —
  `make secrets-bootstrap-state && make secrets-apply` recreates the whole plane.
- never run bare `terraform init` — the stacked backend is intentionally partial and
  only the script supplies it.
- the real-AWS plane needs Terraform >= 1.10 for the `use_lockfile` backend flag.

## Data flow

`infra/.env` → `tools/secrets.py` (parse → validate → `TF_VAR_*`) → terraform → AWS.
Terraform never reads `.env`; the Python tool's only direct AWS step is the opt-in
bucket bootstrap (`make secrets-bootstrap-state`, via the `aws` CLI). Validation repeats
by design at three layers (defense-in-depth, not duplication): `tools/secrets.py`
checks human input before terraform runs, root `variables.tf` protects the stack, and
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
unset, the default `detectai-tfstate-local`):

```bash
aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-tfstate-local --region ap-south-1
```

Real AWS requires `TF_STATE_BUCKET=<bucket>` in `infra/.env` — a sandbox bucket per
engineer/tester (versioned, encrypted, private; bootstrap enables versioning, SSE
defaults to on; Terraform >= 1.10 for `use_lockfile`):

```bash
aws s3 mb s3://<bucket> --region ap-south-1
aws s3api put-bucket-versioning --bucket <bucket> --versioning-configuration Status=Enabled --region ap-south-1
```

## Teardown

| Command                | Removes                                                                                               | Keeps                   |
|------------------------|-------------------------------------------------------------------------------------------------------|-------------------------|
| `make secrets-clean`   | the secret + version (terraform destroy)                                                              | state bucket and ledger |
| `make secrets-destroy` | the secret **and** the state bucket (wipe every object version and delete marker, then `delete-bucket`) | nothing                 |

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
0-day recovery window, and the prod plane keeps 30 days.

## Hygiene

- `api_key` is `sensitive`; the driver prints only its length.
- The state file stores `secret_string` in plaintext — the prod state bucket must be
  versioned, encrypted, and access-restricted (see `backend.example.hcl`).
