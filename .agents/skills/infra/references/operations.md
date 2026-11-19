# Operations — run, verify, troubleshoot

Everything runs from `infra/`; `make help` prints the raw index and
`infra/docs/reference/make.md` annotates every row. The plane verbs delegate
to tfctl's `infra` kind.

## The loop

```sh
make env                       # once: envs/.env from the template
make fmt init validate test    # offline gate — no plane, no credentials
make -C .. floci-up            # emulator on :4566, from the repo root
make plan                      # read-only; banner names plane, carrier, state
make apply                     # auto on Floci, interactive on real AWS
make plan                      # expect no changes
make destroy                   # auto-approved on both planes
```

`make auto-apply` is plan → apply in one run. `make session-clear` and
`make session-refresh` manage the cached carrier triplet for this stack only.
`make seeder-drop` detaches the policy and deletes the role for a clean
account. `PLANE=aws` switches any plane verb to real AWS.

## What the offline gate really runs

| Target | Action |
|--------|--------|
| `make env` | Copy `envs/.env.example` → `envs/.env` **if missing**; never overwrites |
| `make fmt` | `terraform -chdir=terraform fmt -check -recursive -diff` |
| `make init` | Remove `.terraform/terraform.tfstate`, then `init -backend=false -input=false` |
| `make validate` | `terraform validate` on the root and modules |
| `make test` | `terraform test` — the mocked contract tests |

The state-file removal matters: a plane run leaves an S3 backend record in
`.terraform/`, which a bare offline `init` would still consult.

## Beyond the gate

```sh
poetry -C ../tools/tfctl run pytest -m integration   # read-only plan on Floci
```

The integration tier plans against the shared persistent namespace on the
emulator; nothing applies or destroys. `dev` runs no CI, so the offline gate
plus this tier are the local PR gate.

## Failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `the emulator at … did not answer /_localstack/health` | Floci not running | `make -C .. floci-up`, rerun |
| `REDIS_AUTH_TOKEN is required` | cache declared but token missing or < 16 chars | fill `envs/.env` |
| `CACHE_SUBNET_IDS is required` | cache declared without placement | set subnet IDs (Floci: `subnet-default-ap-southeast-2-a`) |
| Atlas key/project/CIDR error | `[[atlas]]` declared but values absent or malformed | fill the Atlas keys; project ID is 24-hex; CIDRs are explicit |
| `make init` consults a backend | stale `.terraform/terraform.tfstate` | use `make init` — it clears the record first |
| apply pauses for confirmation | real-AWS plane | confirm, or use the default Floci plane |
| MFA prompt on a plan → apply stretch | cached 12-hour session is short | enter the code once; `make session-refresh` to re-mint |
| plan still shows changes after apply | state ledger lost on Floci restart | tfctl restores the latest snapshot before planning; rerun `make plan` |

## State and carrier — the boundary

The state bucket (`detectai-infra-tfstate-<account>`) and seeder role
(`detectai-infra-seeder`) are created on demand by whichever run needs them;
there is no bootstrap command. Floci's bucket contents vanish on restart, so
tfctl restores a local snapshot before a plan and saves one after a successful
apply. Its engine, snapshot rules and session cache belong to the `tfctl`
skill — do not reimplement or hand-run them here.

## Cleanup

`make destroy` removes only Terraform-managed resources. Add `--purge-state`
or `--drop-seeder` through tfctl when an account must be left clean; those are
teardown steps of a successful destroy, not recovery steps.
