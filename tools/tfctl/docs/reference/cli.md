# CLI reference

Every verb and flag of `tfctl`, the guard rules that stop misplaced ones, and the exit codes that script against. The narrative behind each row lives in the linked concept and guide pages.

## Ways to invoke

```sh
tfctl --service <name> plan                                # after: make -C tools/tfctl install
poetry -C tools/tfctl run tfctl --service <name> apply # anywhere in the repo, no global install
make -C tools/tfctl secrets-verify SERVICE=<name>          # the tool tree's make wrappers in reference/make.md
python -m app verify                                            # inside tools/tfctl
```

`--service` can be omitted when the current directory (or any parent) holds a `secrets.toml` — the engine resolves the nearest one. Passing the flag anchors resolution to the repo root, so a verb runs identically from any directory.

## The verbs

| Verb | What it does | Doc |
|------|--------------|-----|
| `plan` | terraform plan of the service's stack on the selected plane | [Lifecycle](../guides/terraform-lifecycle.md) |
| `apply` | terraform apply (auto-approve on the emulator; interactive confirm on real AWS) | [Lifecycle](../guides/terraform-lifecycle.md) |
| `auto-apply` | plan → apply → verify in one verb, aborting at the first failure | [Lifecycle](../guides/terraform-lifecycle.md) |
| `verify` | fingerprint audit of the live plane against `infra/.env`; drift exits 1 | [Verification](../guides/verifying.md) |
| `destroy` | terraform destroy, auto-approved on both planes; optional teardown tail via flags | [Lifecycle](../guides/terraform-lifecycle.md) |
| `seeder-drop` | detach `seeder-policy` and delete the seeder role (no confirmations) | [Carrier](../concepts/carrier.md#dropping-the-carrier) |
| `session-clear` | remove the service's cached carrier triplet | [Carrier](../concepts/carrier.md#the-session-verbs) |
| `session-clear-all` | remove every cached carrier triplet (all services) | [Carrier](../concepts/carrier.md#the-session-verbs) |
| `session-refresh-all` | mint every ready service's triplet in one run — one MFA code per device on real AWS | [Carrier](../concepts/carrier.md#the-session-verbs) |

## The flags

| Flag | Verbs | Effect |
|------|-------|--------|
| `--service <name>` | every single-service verb | target `services/<name>` explicitly (anchored to the repo root) |
| `--aws` / `--floci` | all but the batch verbs | choose the plane; mutually exclusive; `--floci` is the default (the emulator on `http://localhost:4566`, override `TFCTL_FLOCI_URL`) |
| `--values-file <path>` | single-service verbs | an alternate values file instead of the service's `infra/.env` |
| `--dry-run` | all | print what would run — banner, backend overrides, and exact commands on the terraform verbs; the three read-only aws commands on `verify`; the would-refresh list on the batch verb. Resolves no session, prompts for nothing |
| `--purge-state` | `destroy` | after destroy: delete every object version in the state bucket, then the bucket (previewed, warned on foreign prefixes) |
| `--force-delete` | `destroy` | real AWS only: delete the secret immediately, skipping its recovery window |
| `--drop-seeder` | `destroy` | after destroy: detach the carrier's inline policy, delete the role |
| `--force` | `session-refresh-all` | re-mint triplets even when a cached one is still valid |

## Guard rules (misplaced flags die loudly)

```text
error: --purge-state only applies to the destroy command
fix:   run it with destroy
error: --service does not apply to the session-refresh-all command (it runs across every service)
fix:   run a single-service verb without --service
```

| Guard | Because |
|-------|---------|
| `--purge-state`, `--force-delete`, `--drop-seeder` accepted only by `destroy` | they are teardown steps of a destroy that succeeded |
| `--force` accepted only by `session-refresh-all` | re-minting is a batch decision |
| `--service` and `--values-file` refused by `session-clear-all` / `session-refresh-all` | these verbs walk every service by design — target a single service with `session-clear` instead |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | the verb did what you asked (including a completed dry run) |
| `1` | any typed failure: guard, schema, validation, assume/apply drift |
| `130` | Ctrl+C — *interrupted: rerun the same verb when ready; terraform writes are atomic per run* |
| `1` (EOF) | a prompt received end-of-input: *cancelled: no input received* |

## Receipts you can script on

Phrases remain valid across both planes, so text-asserting a run is stable:

- the banner opens every run: `plane:` → `carrier:` → `state:` lines ([anatomy](../guides/terraform-lifecycle.md#the-verb-anatomy))
- verify ends with `ok:      the seeded plane matches the .env values` or `fail:    ...`, then the exit code that matches
- the created/removed trio: `created: <thing>`, `removed: <path>`, `deleted: <thing>`, and refresh-all's `summary: N refreshed, N valid, N skipped, N failed`
- values appear only as `KEY *** (N chars, hidden)` and 12-hex fingerprints

## Next Steps

- **[Make targets](make.md)** — the tool-tree's own make layer, plus the service-side wrappers
- **[The terraform lifecycle](../guides/terraform-lifecycle.md)** — the deep story of the terraform verbs
- **[Carrier](../concepts/carrier.md)** — MFA, caching, and the session verbs' full behavior
