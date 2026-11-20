# Testing

Four ways to verify a change, from pure logic to a containerised load run.

## The commands

| Command | What it runs |
| --- | --- |
| `make test-unit` | pure unit tests, no boot, no models |
| `make test-integration` | config planes plus a real in-process gRPC boot with stub models |
| `make test` | both of the above |
| `make test-cov` | both with a 95% coverage gate over `app/` |
| `make test-cov-unit` | unit tests with a report, no gate |
| `make test-cov-html` | full suite with a browsable report in `htmlcov/` |
| `make load-test` | containerised inference + k6 smoke or load scenario |
| `make load-e2e` | k6 only, against `GRPC_ADDR` in `infra/.env.load` |

`make help` prints the full target list.

## Unit tests

`tests/unit/` mirrors `app/`: config resolution, preprocessing, engine, aggregation, model pull/load, observability, and serving. Tests use fake tokenizers, sessions, and stores — no model artifacts and no network. The generated stubs are excluded from coverage.

The contract pin is worth knowing: `tests/unit/serving/test_contract.py` asserts the descriptor's package, both RPCs' message types, the field sets, and the event order. A proto change that is not reflected in the docs fails here.

## Integration tests

`tests/integration/` boots the real server on a gRPC channel:

- config: dev plane from dotenv, prod plane through the floci emulator (skipped when the emulator is down);
- serving: auth, health, reflection (dev only), load shedding, and graceful shutdown with stub engine and tokenizer;
- observability: the null seam and the wired seam.

These assert the edges a unit test cannot: interceptor order, port binding, and health registration.

## Load and e2e

The k6 rig lives in `tests/load/`. Its corpus is generated once from a pinned dataset revision, and the manifest records the chunk counts produced by the real preprocessor — so a config change means regenerating it.

Start here:

```sh
make load-env        # create infra/.env.load from the template
make load-fixtures   # build the corpus once
make load-test       # inference + k6 on an isolated network
```

`SCENARIO` in `infra/.env.load` selects `smoke` (full rejection matrix and one stream per length bucket) or `load` (ramping arrival rate over streaming). `RESOURCE_EXHAUSTED` is counted as designed backpressure, not a failure. See the [full rig manual](../../tests/load/README.md).

## Before you open a PR

```sh
poetry run ruff check . --select F,E --ignore E501
make test-cov
```

CI runs the same pair, then a containerised k6 smoke. `dev` runs no automatic checks of its own.

## Next

- **[Make targets](../reference/make.md)** — every command in one table.
- **[Configuration](../getting-started/configuration.md)** — the values the tests pin.
