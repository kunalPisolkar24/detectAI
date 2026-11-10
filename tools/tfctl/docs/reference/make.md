# Make targets

`make help` (the default goal) prints the raw index; this page is that index plus a purpose and a "reach for it when" for each target. The targets live in three fragments under `mk/` — `local.mk` (install, lint, format), `secrets.mk` (the secrets-verb wrappers), and `tests.mk` — and run everything inside the tool's Poetry environment (`poetry -C <tool dir>`).

## Local — `mk/local.mk`

| Target | What it does | Reach for it when |
|--------|--------------|-------------------|
| `make install` | `poetry install --no-interaction`; after this the `tfctl` command exists in Poetry's env | fresh clone, or after pulling a `poetry.lock` change |
| `make lint` | `ruff check .` | before pushing; the same gate reads the repo's Python style |
| `make format` | `ruff format --check .` (fix with `ruff format .`) | before pushing; the check-only variant never rewrites |
| `make clean` | drop pytest/ruff caches and bytecode | odd failures with nothing obviously changed |

## Tests — `mk/tests.mk`

| Target | What it does | Reach for it when |
|--------|--------------|-------------------|
| `make test` | the unit tier: `pytest -m "not integration"` | the default gate before any push |
| `make test-unit` | alias of `test` | habit |
| `make test-integration` | `pytest -m integration` against a live Floci (skips cleanly when the emulator is unreachable) | verb-level behavior changed, or the integration suite itself did |
| `make test-all` | unit + integration in one go | the full pass before an onboarding-shaped change |
| `make test-cov` | unit tier with a coverage report, failing below 65% | when test coverage is the point, not the side effect |

Both tiers and what each proves are described in the [testing guide](../guides/testing.md).

## Secrets verbs — `mk/secrets.mk`

The tool tree wraps all nine verbs so the `poetry -C …` incantation never needs typing:

```sh
make -C tools/tfctl secrets-apply SERVICE=web
make -C tools/tfctl secrets-destroy SERVICE=web PURGE_STATE=1 DROP_SEEDER=1
```

| Target | Verb it runs | Switches |
|--------|--------------|----------|
| `secrets-plan` | [plan](../guides/terraform-lifecycle.md) | `SERVICE`, `PLANE`, `DRY_RUN` |
| `secrets-apply` | [apply](../guides/terraform-lifecycle.md) | `SERVICE`, `PLANE`, `DRY_RUN` |
| `secrets-auto-apply` | [auto-apply](../guides/terraform-lifecycle.md) | `SERVICE`, `PLANE`, `DRY_RUN` |
| `secrets-verify` | [verify](../guides/verifying.md) | `SERVICE`, `PLANE`, `DRY_RUN` |
| `secrets-destroy` | [destroy](../guides/terraform-lifecycle.md) | `SERVICE`, `PLANE`, `DRY_RUN`, `PURGE_STATE`, `FORCE_DELETE`, `DROP_SEEDER` |
| `secrets-drop-seeder` | [seeder-drop](../concepts/carrier.md#dropping-the-carrier) | `SERVICE`, `PLANE` |
| `secrets-session-clear` | [session-clear](../concepts/carrier.md#the-session-verbs) | `SERVICE`, `PLANE` |
| `secrets-session-clear-all` | [session-clear-all](../concepts/carrier.md#the-session-verbs) | — |
| `secrets-session-refresh-all` | [session-refresh-all](../concepts/carrier.md#the-session-verbs) | `FORCE`, `DRY_RUN` |

The wrappers are thin and convention-following rather than clever:

- `SERVICE=<name>` is required for the single-service verbs — the engine starts in the tool tree, where a nearest-`secrets.toml` walk upward finds nothing — and unused (silently ignored) by the two `session-*-all` batch verbs, which the [engine's own guards](cli.md) also protect.
- Every switch validates before anything runs (`Invalid PLANE 'x'. Use PLANE=floci or PLANE=aws.`, `Invalid DRY_RUN '2'. Use 0 or 1.`), and each `0|1` switch appends its flag only when `1`.
- `PLANE=floci|aws` flips the default to the emulator; `DRY_RUN=1` turns any verb into its printed stakeout.

Services that want per-service ergonomics still wrap the CLI in their own `mk/secrets.mk` — document-parser's is the reference example, hardwired to its slug with the same switch names. A new service onboards by [writing its two files](../guides/onboarding-a-service.md), not a make fragment.

## Next Steps

- **[Testing](../guides/testing.md)** — the tier-by-tier story behind the test targets
- **[CLI reference](cli.md)** — what the service-side make wrappers call into
- **[Onboarding a service](../guides/onboarding-a-service.md)** — why a service contributes files instead of make targets
