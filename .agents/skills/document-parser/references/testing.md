# Testing — unit, integration, load

Two pytest trees are a hard boundary (`mk/tests.mk`), plus a k6 rig.

| Command | What actually runs | Reach for it when |
|---------|--------------------|-------------------|
| `make test` | `poetry run pytest tests -q` — unit *and* integration | the default gate before pushing anything |
| `make test-unit` | `pytest tests/unit` — pure logic with fakes, **no app boot** | iterating on a validation, cleaning, or cap rule |
| `make test-integration` | `pytest tests/integration` — the production app with the real lifespan-config boot | the route moved, wiring changed, or a factory changed |
| `make load-fixtures` | `python -m tests.load.generate` — builds the k6 corpus once under `tests/load/assets/` (gitignored, self-checked) | first load run on a fresh tree, or after the corpus grammar changed |

The tree rule is two-directional: unit tests never boot the app,
integration tests always boot the real one. Keep new tests on the side that
matches.

## The k6 rig (`mk/load.mk`)

One `infra/.env.load` (from `.env.load.example`) configures everything —
including its `SCENARIO` line (`smoke` or `load`). There are no CLI or shell
overrides: **edit the file, rerun.** Compose injects the file wholesale, so
one edit re-arms the parser and k6 together.

```sh
make load-env        # create infra/.env.load from the template if missing
make load-fixtures   # corpus once per fresh tree (load-test/e2e fail loudly without it)
make load-test       # container rig: parser + k6 on an isolated network, no host ports
make load-e2e        # k6 alone, against whatever the file's API_URL names
make load-down       # remove the rig and the e2e-run leftovers
```

| Scenario | Shape | Pass criteria |
|----------|-------|---------------|
| `smoke` | 1 VU, 1 iteration: probes, one 200 per format, then the full rejection matrix | every request asserts its exact answer |
| `load` | `ramping-arrival-rate` shaped by the `STAGES` line — ramp, spike, or soak | `p95 < 1500 ms`, `p99 < 3000 ms`, success ≥ 99% |

The smoke matrix maps the guards one to one: missing/wrong key (401),
oversized body (413), multipart without a `file` field (422), then every
generated invalid fixture at the status the generator pinned for it — so a
guard regression re-runs a pinned wrong answer. Because the parser's own
knobs arrive through the same file, raising `UPLOAD_LIMIT_BYTES` flips both
the parser cap and the matrix's 413 case together.

A readiness `503` during a run is recorded as **backpressure, not a
failure**.

Nothing in the corpus is handwritten: the generator self-checks every file
through the real pipeline, so the manifest always describes what the service
actually does. The rig's own README lives at `tests/load/README.md`; the
pytest suites' design rationale is in
`services/document-parser/docs/guides/testing.md`.

[Back to the briefing](../SKILL.md)
