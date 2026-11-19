# The verb sheet

Every verb and flag of `tfctl`, the guards that stop misplaced ones, the
exit codes to script against, and the make wrappers around them. Verbs a
kind does not declare die with `argparse` (exit 2), or
`error: <verb> is not a verb of the <kind> kind` (exit 1) once a stack is
resolved.

## Ways to invoke

```sh
tfctl --service <name> plan                                # after: make -C tools/tfctl install
poetry -C tools/tfctl run tfctl --service <name> apply     # anywhere in the repo, no global install
make -C tools/tfctl secrets-verify SERVICE=<name>          # the tool tree's make wrappers
python -m app verify                                       # inside tools/tfctl
poetry -C tools/tfctl run tfctl --stack-dir observability plan   # a stack outside services/
```

`--service` can be omitted when the current directory (or any parent) holds
a declaration file — the engine resolves the nearest one. `--stack-dir`
anchors to an explicit directory instead of walking: that is how the
stack-dir kinds are driven (e.g. `observability`). Passing either flag runs
the verb identically from any directory.

## The verbs

| Verb | What it does |
|------|--------------|
| `plan` | terraform plan of the stack on the selected plane |
| `apply` | terraform apply (auto-approve on the emulator; interactive confirm on real AWS) |
| `auto-apply` | plan → apply in one verb, aborting at the first failure, then the kind's live audit when it supplies one (secrets does; observability stops after apply) |
| `verify` | fingerprint audit of the live plane against `infra/.env`; drift exits 1 (secrets-only) |
| `check` | observability: validate the credential triple and resolve the account live over GraphQL (no state, no terraform) |
| `destroy` | terraform destroy, auto-approved on both planes; optional teardown tail via flags |
| `seeder-drop` | detach `seeder-policy` and delete the seeder role (no confirmations) |
| `session-clear` | remove the stack's cached carrier triplet |
| `session-refresh` | drop and re-mint the stack's cached carrier triplet |
| `session-clear-all` | remove every cached carrier triplet (all stacks) |
| `session-refresh-all` | mint every ready service's triplet in one run — one MFA code per device on real AWS |
| `state-save` | copy the stack's state ledger to a local timestamped snapshot (floci also does this automatically after a successful apply) |
| `state-load` | restore a local snapshot into the ledger; `--force` overwrites a non-empty one |
| `state-status` | show whether the ledger is present and list the available local snapshots |

## The flags

| Flag | Verbs | Effect |
|------|-------|--------|
| `--service <name>` | every single-service verb | target `services/<name>` explicitly (anchored to the repo root) |
| `--stack-dir <path>` | every single-stack verb | drive an explicit stack directory that holds a declaration (e.g. `observability`) |
| `--aws` / `--floci` | all but the batch verbs | choose the plane; mutually exclusive; `--floci` is the default (emulator on `http://localhost:4566`, override `TFCTL_FLOCI_URL`) |
| `--values-file <path>` | single-service verbs | an alternate values file instead of the stack's own |
| `--dry-run` | all | print what would run — banner, backend overrides, exact commands on the terraform verbs; the three read-only aws commands on `verify`; the would-refresh list on the batch verb. Resolves no session, prompts for nothing |
| `--purge-state` | `destroy` | after destroy: delete every object version in the state bucket, then the bucket (previewed, warned on foreign prefixes) |
| `--force-delete` | `destroy` | real AWS only: delete the secret immediately, skipping its recovery window |
| `--drop-seeder` | `destroy` | after destroy: detach the carrier's inline policy, delete the role |
| `--force` | `session-refresh-all`, `state-load` | re-mint triplets even when cached, or overwrite a non-empty ledger |
| `--file <path>` | `state-save`, `state-load` | explicit snapshot path (defaults to the plane's `latest`) |

## Guards (misplaced flags die loudly)

| Guard | Because |
|-------|---------|
| `--purge-state`, `--force-delete`, `--drop-seeder` accepted only by `destroy` | they are teardown steps of a destroy that succeeded |
| `--force` accepted only by `session-refresh-all` and `state-load` | re-minting is a batch decision; overwriting a ledger is explicit |
| `--file` accepted only by `state-save` / `state-load` | no other verb reads or writes a snapshot file |
| `--service` refused by `session-clear-all` / `session-refresh-all` | these verbs walk every service by design — target one with `session-clear` |
| `--service` and `--stack-dir` never together | they name two different stacks; pass one |
| `--stack-dir` refused by the batch verbs | they walk the services namespaces — target a single stack with `session-clear` / `session-refresh` |

## The make wrappers

The tool tree wraps the secrets verbs so the `poetry -C …` incantation never
needs typing (`mk/secrets.mk`):

| Target | Switches |
|--------|----------|
| `secrets-plan` / `secrets-apply` / `secrets-auto-apply` / `secrets-verify` | `SERVICE`, `PLANE`, `DRY_RUN` |
| `secrets-destroy` | `SERVICE`, `PLANE`, `DRY_RUN`, `PURGE_STATE`, `FORCE_DELETE`, `DROP_SEEDER` |
| `secrets-drop-seeder` | `SERVICE`, `PLANE` |
| `secrets-session-clear` | `SERVICE`, `PLANE` |
| `secrets-session-clear-all` | — |
| `secrets-session-refresh-all` | `FORCE`, `DRY_RUN` |

`SERVICE=<name>` is required for the single-service verbs (the engine starts
in the tool tree, where a nearest-`secrets.toml` walk finds nothing) and
silently ignored by the batch verbs. Every switch validates before anything
runs; each `0|1` switch appends its flag only when `1`. Services that want
per-service ergonomics wrap the CLI in their own `mk/secrets.mk` —
document-parser's and payment-webhook's are hardwired examples with the same
switch names (`PLANE=floci|aws`, `DRY_RUN=0|1`, `FORCE_DELETE=0|1`,
`FORCE=0|1`). A new service onboards by writing its two files, not a make
fragment.

## State snapshots in practice

On floci the bucket's contents vanish on restart, so `plan`/`apply`/
`auto-apply` restore `~/.local/share/tfctl/state/<slug>/floci/latest.tfstate`
before planning and save a fresh snapshot after a successful apply. Real AWS
is explicit-only: versioned S3 needs no local copy. A ledger with no snapshot
only produces a `warning:` — the per-stack guard still blocks a plan that
would create live resources. The observability stack wraps these verbs in
`make state-backup` / `state-restore` / `state-status` and adds
`make recover-state` to import the live New Relic plane when no snapshot
exists; see the observability skill's publishing reference.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | the verb did what you asked (including a completed dry run) |
| `1` | any typed failure: guard, schema, validation, assume/apply drift |
| `2` | an unknown verb or an unresolvable argument (argparse) |
| `130` | Ctrl+C — *interrupted: rerun the same verb when ready; terraform writes are atomic per run* |
| `1` (EOF) | a prompt received end-of-input: *cancelled: no input received* |

## Receipts you can script on

Phrases remain valid across both planes, so text-asserting a run is stable:

- the banner opens every run: `plane:` → `carrier:` → `state:` lines
- verify ends with `ok:      the seeded plane matches the .env values` or
  `fail:    ...`, then the exit code that matches
- the subprocess trio: `created: <thing>`, `removed: <path>`,
  `deleted: <thing>`; refresh-all's
  `summary: N refreshed, N valid, N skipped, N failed`
- the state ledger: `note: state ledger is empty after emulator restart;
  restoring <path>`, `note: state bucket <bucket> is missing; creating it`,
  `saved: <path> (serial N)`, `restored: <path> -> <bucket> / <key>`
- values appear only as `KEY *** (N chars, hidden)` and 12-hex fingerprints

Every failure is shaped before it is printed — an `error:` line with a
`fix:` line, both human sentences. `note:` logs reality without opinion
(healed buckets, assumed-role substitutions); `warning:` continues the run
but you probably want to look.
