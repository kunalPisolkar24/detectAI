# The AWS slice — secrets, config, no IAM

What `make secrets-*` runs, what the planes are, and the gotchas that bite.

## What the stack creates (two resources, one naming root)

| Resource | Name | Who reads it |
|----------|------|--------------|
| Secrets Manager blob | `detectai/document-parser/secrets` | prod config plane at boot — one fetch, JSON of env-named keys |
| SSM parameters | `/detectai/document-parser/<KEY>` | prod config plane at boot — non-secret config from the `SSM_SEED_KEYS` allowlist in `tools/secrets.py` |

The stack never deploys the app and creates no IAM. The seeder role
(`detectai-document-parser-seeder`, policy `seeder-policy`) is out-of-stack
by design (terraform never manages its own carrier). Zero-config on real AWS:
its trust is the **auto-detected ambient caller** (or a pinned
`SEEDER_TRUST_USER_ARN`), `make secrets-seeder-bootstrap` creates it once,
idempotently, under your personal creds, and every carrier verb assumes it
with your MFA for one hour — the triplet rides as env credentials (outrank
any profile, nothing written to `~/.aws`) and is cached gitignored in
`infra/.aws-session.json` so a multi-verb stretch prompts once.

## Two planes, flipped by one line

`EMULATOR_ENDPOINT` in `infra/.env` selects everything: set → Floci/LocalStack
emulator (dummy `test` credentials, auto-approved apply, in-memory state,
0-day secret deletion); empty → real AWS (ambient personal creds + the
MFA-gated seeder session, interactive confirm, 30-day recovery window,
`TF_STATE_BUCKET` required). The provider block adapts itself; nothing in
the stack reads an account id.

The emulator accepts every IAM call but never enforces IAM policies — a
green apply there proves structure only; enforcement bites on real AWS.

## The verb order

```sh
make env                         # infra/.env — the single config input
make secrets-check               # validate + preview plane/vars — no terraform, no AWS
make secrets-seeder-bootstrap    # one-time: the out-of-stack seeder role
make secrets-bootstrap-state     # state bucket for the selected plane (idempotent)
make secrets-plan
make secrets-apply               # auto on the emulator, confirm on real AWS
```

`tools/secrets.py` is the only bridge into terraform: it parses and
validates `infra/.env`, composes the backend config into a temp file, and
feeds `init -reconfigure` — terraform never reads `.env`, and **bare
`terraform init` is never valid** in `infra/terraform`. Validation repeats
at three layers by design (tool → root `variables.tf` → module
`variables.tf`).

## Teardown verbs

| Verb | Removes | Keeps |
|------|---------|-------|
| `make secrets-clean` | blob + SSM parameters | state bucket, ledger, seeder role |
| `make secrets-destroy` | all of it, plus object versions and the bucket (`--purge-state`) and the seeder role (`--drop-seeder`) | nothing |
| `make secrets-drop-seeder` | the seeder policy + role only (personal creds; the role cannot delete itself) | state bucket, ledger, stack resources |

`terraform destroy` never touches the state bucket — only the purge verb
does, and only after destroy succeeded. On real AWS, `secrets-destroy`
demands the bucket name as a typed barrier and warns if the bucket holds
objects outside `document-parser/` — deleting a shared sandbox bucket takes
sibling stacks' state too.

## Gotchas

- Changing `TF_STATE_BUCKET` (or region) after a first apply points terraform
  at a new empty ledger — `plan` offers to recreate everything; nothing
  migrates.
- The emulator's S3/Secrets data is in-memory: a container restart can drop
  it. Any terraform verb recreates the bucket, so a bare
  `make secrets-apply` rebuilds the plane.
- The tool refuses to run when the ambient identity already *is* a seeder
  session (stale exported `AWS_*` triplets) — `make secrets-session-clear`
  drops the local cache and unset the exports.
- Real AWS needs Terraform ≥ 1.10 for the `use_lockfile` backend flag.
- The state file stores `secret_string` in plaintext — keep the prod bucket
  versioned, encrypted, access-restricted.
- Skipping the 30-day recovery window needs `--force-delete`, which has no
  make wrapper: `poetry run python tools/secrets.py destroy --force-delete`.
  Or seed without a window at all: `SECRET_RECOVERY_WINDOW=0` in `infra/.env`
  makes `terraform destroy` delete the blob immediately (opt-in; unset keeps
  30 days, `7-30` keeps an AWS window; the emulator plane always uses 0).

Full operator guide: `services/document-parser/docs/guides/infrastructure.md`
· credential handling: `services/document-parser/docs/guides/secrets.md`

[Back to the briefing](../SKILL.md)
