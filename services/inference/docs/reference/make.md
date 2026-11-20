# Make Targets

`make help` prints the grouped list. The Makefile includes one fragment per area under `mk/`.

## Local — `mk/local.mk`

| Target | Action |
| --- | --- |
| `install` | `poetry install` |
| `lock` | resolve and update `poetry.lock` |
| `env` | create `infra/.env` from the template if missing |
| `clean` | remove caches and bytecode under `app/` |
| `run` | `poetry run python -m app.main` |

## Codegen — `mk/proto.mk`

| Target | Action |
| --- | --- |
| `proto` | generate Python gRPC stubs from `api/proto` into `app/serving/generated/` |

## Tests — `mk/tests.mk`

| Target | Action |
| --- | --- |
| `test` | unit + integration |
| `test-unit` | pure logic, no boot |
| `test-integration` | config planes and a real gRPC boot with stub models |
| `test-cov` | full suite, 95% gate, term-missing report |
| `test-cov-unit` | unit tests with a report, no gate |
| `test-cov-html` | full suite with HTML report in `htmlcov/` |

## Images — `mk/docker.mk`

| Target | Action |
| --- | --- |
| `build` | build `IMAGE=cpu\|gpu` (default `cpu`) |
| `up` | start the selected Compose stack |
| `down` | stop it |

## Secrets — `mk/secrets.mk`

| Target | Action |
| --- | --- |
| `secrets-check` | validate `infra/.env`, preview the plane without terraform |
| `secrets-plan` | terraform plan |
| `secrets-apply` | apply; interactive confirmation on AWS |
| `secrets-auto-apply` | validate → plan → apply → verify, stopping at the first failure |
| `secrets-verify` | compare the live plane against `infra/.env` by fingerprint |
| `secrets-clean` | destroy the secrets blob, keep state |
| `secrets-destroy` | full teardown, including state and seeder role |
| `secrets-drop-seeder` | detach and delete the seeder role |
| `secrets-session-clear` | drop the cached seeder session |
| `secrets-session-clear-all` | drop every cached seeder session |
| `secrets-session-refresh-all` | mint fresh sessions for every ready service |
| `secrets-test` | run the tfctl engine test suite |

## Load — `mk/load.mk`

| Target | Action |
| --- | --- |
| `load-env` | create `infra/.env.load` from the template if missing |
| `load-fixtures` | regenerate the dataset corpus under `tests/load/assets/` |
| `load-test` | inference + k6 on an isolated network (`IMAGE=cpu\|gpu`) |
| `load-e2e` | k6 alone, against the file's `GRPC_ADDR` |
| `load-down` | remove the rig and e2e leftovers |

The `SCENARIO` line in `infra/.env.load` picks `smoke` or `load`. See the [load rig manual](../../tests/load/README.md).

## Next

- **[Quick Start](../getting-started/quickstart.md)** — the common path.
- **[Testing](../guides/testing.md)** — what each suite asserts.
