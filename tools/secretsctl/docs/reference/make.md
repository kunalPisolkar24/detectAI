# Make targets

`make help` (the default goal) prints the raw index; this page is that index plus a purpose and a "reach for it when" for each target. The targets live in two fragments under `mk/` and run everything inside the tool's Poetry environment (`poetry -C <tool dir>`).

## Local — `mk/local.mk`

| Target | What it does | Reach for it when |
|--------|--------------|-------------------|
| `make install` | `poetry install --no-interaction`; after this the `secretsctl` command exists in Poetry's env | fresh clone, or after pulling a `poetry.lock` change |
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

## No make targets exist for the secrets verbs — deliberately

The engine's verb surface (`plan`, `apply`, `verify`, …) is the [CLI](cli.md), not make. Services that want one-command ergonomics wrap the CLI in their own `mk/secrets.mk` — document-parser's is the reference example: `make secrets-check | plan | apply | auto-apply | verify | clean | destroy | …` with `PLANE=floci|aws`, `DRY_RUN=1` and friends as switches. Those wrappers accept the same named switches because they exist, but nothing here generates or maintains them; a new service onboards by [writing its two files](../guides/onboarding-a-service.md), not a make fragment.

## Next Steps

- **[Testing](../guides/testing.md)** — the tier-by-tier story behind the test targets
- **[CLI reference](cli.md)** — what the service-side make wrappers call into
- **[Onboarding a service](../guides/onboarding-a-service.md)** — why a service contributes files instead of make targets
