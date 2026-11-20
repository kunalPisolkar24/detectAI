# Testing the service

Three layers, each answering a different question: **unit tests hold pure logic
with fakes; integration tests boot the real server; the load rig sends real
traffic** — three trees with a hard boundary between them.

| Question | Layer | Command |
|----------|-------|---------|
| Does this function do the right math? | unit | `make test-unit` |
| Does the real gRPC boot wire correctly? | integration | `make test-integration` |
| Do the config planes read what seeding writes? | integration | `make test-integration` |
| Does the service behave under traffic? | load | `make load-test` / `make load-e2e` |
| Is the 95% gate green? | all | `make test-cov` |

## Unit — fast and faked

`tests/unit/` mirrors `app/` with fake tokenizers, ONNX sessions, and artifact
stores — no model files and no network:

| Folder | Covers |
|--------|--------|
| `tests/unit/config/` | settings validators, dotenv, factories, AWS adapters, plane selection |
| `tests/unit/inference/` | preprocessing, engine guards, aggregation, analysis, runtime |
| `tests/unit/models/` | pull specs, artifact store, parallel manager, offline loader |
| `tests/unit/observability/` | null vs wired boot, resource identity, instruments |
| `tests/unit/serving/` | auth, contract pins, mapper, server, servicer |
| root files | boot wiring and `main` |

`tests/unit/serving/test_contract.py` pins the descriptor: package name, both
RPCs' message types, request/result field sets, and the `started → progress →
result` oneof order. A proto change that is not reflected in the docs fails
here.

## Integration — real boot, stub models

`tests/integration/` boots the server on a real in-process gRPC channel. Config
cases exercise the dev plane and the prod plane through the floci emulator
(they skip when the emulator is down). Serving cases assert auth, health,
dev-only reflection, load shedding, and graceful shutdown with a stub engine
and tokenizer. Observability cases assert both the null seam and the wired
one. No real model artifacts are needed.

## Coverage

`make test-cov` runs unit + integration with a **95% gate** over `app/`
(generated stubs omitted), with a term-missing report. `make test-cov-unit`
gives a unit-only report with no gate; `make test-cov-html` writes `htmlcov/`.
CI runs Ruff (`F,E`, ignoring `E501`) and `make test-cov`, then a containerised
k6 smoke — run both locally before opening a PR.

## Load + e2e — traffic, not tests

The k6 rig lives in `tests/load/`. One file — `infra/.env.load` (copy the
template) — configures everything, `SCENARIO` included.

```sh
make load-env        # create infra/.env.load from the example
make load-fixtures   # generate the corpus once (gitignored)
make load-test       # inference + k6 on an isolated network (IMAGE=cpu|gpu)
make load-e2e        # k6 alone, against GRPC_ADDR
make load-down       # remove the rig and leftovers
```

`make load-fixtures` pulls a pinned dataset revision and writes a corpus plus
a manifest recording the chunk counts produced by the **real** preprocessor —
so a chunking config change means regenerating the corpus. `load-check` is a
prerequisite of `load-test` and `load-e2e`: it rejects a missing env file, an
unknown `SCENARIO`, or a missing corpus before compose runs.

| Scenario | Shape | Pass criteria |
|----------|-------|---------------|
| `smoke` | one unary `Detect` per model, one full stream per length bucket, plus the rejection matrix | every request asserts its exact answer |
| `load` | `ramping-arrival-rate` over `AnalyzeDocument` | loose dev thresholds on success rate, stream p95/p99, time-to-first-event p95 |

`RESOURCE_EXHAUSTED` is reported through a dedicated backpressure counter and
does **not** count as a failure: it is the service shedding load as designed.
Selection is deterministic — the bucket cycles by iteration and the row by a
prime stride over VU and iteration — and each request carries `sample_id`,
`profile`, `label`, `domain`, and `split` tags so a failure can be traced to
one corpus row.

## The knobs

`infra/.env.load` carries `SCENARIO`, `GRPC_ADDR`, the profile stages, and the
thresholds. Service config stays in `infra/.env`, which the load-rig service
reads like any other run; Compose passes `API_KEY` to k6 without duplicating
it. The full rig manual is `services/inference/tests/load/README.md`.

[Back to the briefing](../SKILL.md)
