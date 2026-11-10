# The config planes — Secrets Manager, SSM, and the tfctl carrier

What `make secrets-*` runs, what the planes are, and the gotchas that bite.
The engine behind every verb is [`tools/tfctl`](../../../../tools/tfctl/docs/README.md)
— its mechanics are the `tfctl` skill's subject; here is what a service
operator actually touches.

## What the stack creates (two resources, one naming root)

| Resource | Name | Who reads it |
|----------|------|--------------|
| Secrets Manager blob | `detectai/document-parser/secrets` | prod config plane at boot — one fetch, JSON of env-named keys |
| SSM parameters | `/detectai/document-parser/<KEY>` | prod config plane at boot — non-secret config from the `ssm.keys` allowlist in the service's `secrets.toml` |

The stack never deploys the app and creates no IAM — its job is data, not
permissions; the app reads the blob and the prefix under whatever identity
its environment carries. The seeder role
(`detectai-document-parser-seeder`, policy `seeder-policy`) is out-of-stack
by design (terraform never manages its own carrier):

- Trust: the **auto-detected ambient caller**; an assumed-role caller strips to
  its base role, and with no derivable device the verb refuses — ride your IAM
  user instead.
- Carrier verbs assume the role with your MFA for a **12-hour session** (the
  STS ceiling); the triplet rides as env credentials — outranks any profile,
  nothing written to `~/.aws` — and is cached gitignored in
  `tools/tfctl/.session-cache/<service>.json` so a plan → apply stretch
  prompts once. Before every session resolve the role is created when missing
  and reconciled (trust, 12h cap, `seeder-policy`); a converged role passes
  silently, and a cached session only skips the assume and its MFA prompt.
  A cache hit needs the same role ARN and **more than 10 minutes remaining**.
- The driver prints `carrier: role session (…, valid mm:ss)` on every run
  and refuses to run when the ambient identity already *is* a seeder session
  (stale exported `AWS_*` triplets) — `make secrets-session-clear` drops the
  cache; `tfctl session-refresh-all` mints every ready service's triplet in
  one run behind a single MFA code (`--force` re-mints, `--dry-run` lists).
- The role teardown runs on personal creds (a role cannot delete itself).

## Two planes, flipped by one flag

`make secrets-<verb> PLANE=floci|aws` selects everything: `floci` → the
Floci/LocalStack emulator (dummy `test` credentials, auto-approved apply,
in-memory state, 0-day secret deletion); `aws` → real AWS (ambient personal
creds + the MFA-gated seeder session, interactive confirm, 30-day recovery
window). Every AWS name derives from the declaration's slug — the state
bucket `detectai-document-parser-tfstate-<account>` is created on demand; the
two planes hold separate state keys (`document-parser/floci/…` vs
`document-parser/…`). The provider block adapts itself; nothing in the stack
reads an account id. The app runtime carries no endpoint knob — its
credentials ride boto3's default chain from the deployment environment.

The emulator accepts every IAM call but never enforces IAM policies — a
green apply there proves structure only; enforcement bites on real AWS.

## The verb order

```sh
make env                       # infra/.env — the single config input
make secrets-check             # validate + preview plane/vars — no terraform, no AWS
make secrets-plan              # bucket and seeder role ride on demand
make secrets-apply             # auto on the emulator, confirm on real AWS
make secrets-verify            # live plane vs .env — fingerprints only, exit 1 on drift
```

`make secrets-auto-apply` is the one-shot: validate → plan → apply → verify
in one run, aborting at the first failure — onboarding a plane or seeding a
values change end-to-end is exactly that.

tfctl is the only bridge into terraform: it parses and validates
`infra/.env` against the `secrets.toml` declaration, composes the backend
config into a temp file, and feeds `init -reconfigure` — terraform never
reads `.env`, and **bare `terraform init` is never valid** in
`tools/tfctl/app/kinds/secrets/stack`. Validation repeats at three layers by
design (engine → stack `variables.tf` → module `variables.tf`).

## Teardown verbs

| Verb | Removes | Keeps |
|------|---------|-------|
| `make secrets-clean` | blob + SSM parameters | state bucket, ledger, seeder role |
| `make secrets-destroy` | all of it, plus object versions and the bucket (`--purge-state`) and the seeder role (`--drop-seeder`) | nothing |
| `make secrets-drop-seeder` | the seeder policy + role only (personal creds; the role cannot delete itself) | state bucket, ledger, stack resources |

`terraform destroy` never touches the state bucket — only the purge verb
does, and only after destroy succeeded. Teardown runs unattended: destroy
auto-approves, and the purge prints a summary — warning if the bucket holds
objects outside `document-parser/`. Destroy schedules the secret into the
recovery window (30 days, or whatever `recovery_window` the declaration
seeded); the emulator plane always uses 0.

## Gotchas

- A change of region or account points terraform at a different, empty
  ledger — `plan` offers to recreate everything; nothing migrates.
- The emulator's S3/Secrets data is in-memory: a container restart can drop
  it. Any terraform verb recreates the bucket, so a bare
  `make secrets-apply` rebuilds the plane.
- Real AWS needs Terraform ≥ 1.10 for the `use_lockfile` backend flag.
- The state file stores `secret_string` in plaintext — keep the prod bucket
  versioned, encrypted, access-restricted.
- Skipping an existing recovery window needs `FORCE_DELETE=1` on a
  destroy-call target (`make secrets-destroy FORCE_DELETE=1`).

Full operator guide: `services/document-parser/docs/guides/infrastructure.md`
· credential handling: `services/document-parser/docs/guides/secrets.md`
· the engine's own mechanics: the `tfctl` skill.

[Back to the briefing](../SKILL.md)
