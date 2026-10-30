---
name: document-parser
description: DetectAI's document-parser — the stateless FastAPI service that turns PDF, DOCX, or TXT uploads into extracted text (services/document-parser). Use when working anywhere in that tree — routes, validation, or the extraction pipeline, config planes or secrets tooling, the OTel facade, unit/integration tests or the k6 load rig, compose, or its AWS secrets terraform — running, configuring, extending, or debugging the service.
---

# Document-parser — the extraction service

A stateless FastAPI service: a PDF, DOCX, or TXT multipart upload goes in,
extracted text comes out as JSON. No database, no queue, no cache — one
request is self-contained, and scale means more instances, never a worker
pool. The pipeline inside one request is synchronous by design: a
cooperative deadline is computed once from `PROCESSING_BUDGET_SECONDS` and
checked between PDF pages and DOCX members, so a doomed parse stops at the
budget. Current shape: one endpoint (`POST /api/v1/extract`) behind one
credential (`API_KEY` via `x-api-key`), dev/prod config planes, the OTel
facade with six instruments, two pytest suites, and a two-scenario k6 rig.

## Map

```text
services/document-parser/
├── app/
│   ├── main.py            lifespan: resolve config, wire services, start observability
│   ├── api/               the extract route: key guard, bounded read, multipart parse, verdicts → HTTP
│   ├── validation/        admission: magic sniff + container checks + bounds → typed verdicts
│   ├── extraction/        pipeline: strategies, deadline, cleaning, output cap
│   ├── config/            planes (dev env-over-file, prod AWS), typed Settings
│   └── observability/     OTel facade: traces, metrics, logs — or NullObservability
├── infra/                 .env planes, compose files, secrets terraform stack
├── tools/secrets.py       the secrets pipeline driver (parse → validate → terraform)
├── tests/                 unit + integration + load (k6) — a hard tree boundary
├── specification/         design history for maintainers — history, not truth
├── docs/                  the deep documentation tree
└── mk/ + Makefile         make targets: local / docker / tests / load / secrets
```

The layering is inward-facing: `api` orchestrates, `validation` and
`extraction` do the two halves of the work, `config`/`observability` serve
them. Nothing in the inner layers knows about HTTP.

## Run it

```sh
cd services/document-parser
make install && make env    # poetry deps; create infra/.env — set a real API_KEY (≥ 16 chars)
make run                    # uvicorn --reload on :8000
curl http://localhost:8000/api/v1/health
```

Docker: `make build && PORT=8000 make up`. Probes, the request shape, and the
fail-fast table: [references/running.md](references/running.md)

## Change the pipeline without breaking it

- `api/` never parses documents — it bounds the body, hands bytes down, and
  translates typed verdicts (its own auth guard, `413`, `415`, `422`, `504`)
  into HTTP. Inner layers speak verdicts, never HTTP.
- The declared `Content-Type` is metadata only: **the sniffed MIME wins** and
  is what validation, extraction, and the response all use.
- The deadline is a value passed down, checked in strategy inner loops —
  overshoot is bounded to one page or one member; the shaped `504` is the
  breach itself, no orphaned work ever finishes alone.
- Interior caps (1,000 pages, 30 MiB unpacked DOCX, 1,000,000 character
  output cap) guarantee termination regardless of the clock.
- `truncated` is one flag with one meaning: the returned text is not the
  complete extractable text. Nothing else may flip it.
- Metric names are a contract — dashboards query them by name, so a rename
  is a migration, not an edit.
- Finish every change with `make test` (unit + integration in one go).

## Config and secrets rules

- Config is resolved **once at boot** and frozen; changing a knob means a
  restart, never a mid-flight edit.
- The boot fails fast with named errors: `API_KEY` under 16 characters, or
  the OTel endpoint set without a ≥ 16-char license key.
- `x-api-key` is the only carrier; the compare is constant-time; missing and
  invalid are indistinguishable in the response; secret values are never
  logged anywhere.
- Dev plane = process env over `infra/.env`. Prod plane = one Secrets
  Manager blob fetch + one SSM prefix read (`/detectai/document-parser/`).
  Secrets and SSM config are disjoint planes — a key seeded into both is an
  operator error the boot refuses to paper over.

## Infra and testing — the short tours

- **AWS slice:** `make env` → `make secrets-check` (always first) →
  `make secrets-bootstrap-state` → `make secrets-plan` →
  `make secrets-apply` — auto-approved on the Floci emulator plane,
  interactive on real AWS; the plane flips on `EMULATOR_ENDPOINT` in
  `infra/.env`. Teardown: `secrets-clean` keeps the bucket and ledger,
  `secrets-destroy` wipes everything including the role.
  Verbs, state gotchas: [references/infra.md](references/infra.md)
- **Tests:** `make test` is the default gate; `make test-unit` for
  logic-only iteration, `make test-integration` when wiring or boot changed;
  the k6 rig is `make load-env` → `load-fixtures` (once per fresh tree) →
  `load-test` / `load-e2e`. What each really runs:
  [references/testing.md](references/testing.md)

## Observability

The whole telemetry build is switched by one env var,
`OTEL_EXPORTER_OTLP_ENDPOINT`: unset boots `NullObservability` (legitimate,
zero SDK objects); set boots the full pipeline and additionally requires
`NEW_RELIC_LICENSE_KEY` (≥ 16 chars) or the boot fails. Traces, metrics, and
logs ship over OTLP/HTTP direct to New Relic EU on one shared resource
(service name, version, deployment environment); providers are injected —
the OTel global registry is never touched, so parallel boots cannot cross
wires. Metric names: `rejected_uploads_total`, `parsed_documents_total`,
`extraction_failures_total`, `extraction_timeouts_total`,
`extraction_duration_seconds`, `in_flight_requests`.

Boards, alerts, and the push pipeline they rely on belong to the
`observability` skill — not this one.

## Guardrails

- Never commit real `infra/.env` or `infra/.env.load` values — only the
  committed templates (`.env.example`, `.env.load.example`) enter git.
- No worker pool or executor anywhere — the answer to load is more
  instances; keep the runtime the simplest thing that works for one instance.
- No second credential carrier (`Authorization: Bearer` twins) — every extra
  envelope multiplies the comparison surface.
- Never run bare `terraform init` in `infra/terraform` — the stacked backend
  is intentionally partial; `tools/secrets.py` supplies it.
- Do not cross service boundaries or share code between services (monorepo
  rule).
- Write documentation under `docs/` in its established style; `specification/`
  records how decisions were made — cite it, don't extend it.

## When you need depth

| Need | Go to |
|------|-------|
| Request flow, runtime and boot model | `services/document-parser/docs/concepts/architecture.md` |
| What gets in (sniffing, bounds) | `services/document-parser/docs/concepts/validation.md` |
| Strategies, cleaning, caps, truncation | `services/document-parser/docs/concepts/extraction.md` |
| Every env key and fail-fast rule | `services/document-parser/docs/getting-started/configuration.md` |
| Endpoint and status-code contract | `services/document-parser/docs/reference/http-api.md` |
| What each test suite runs | [references/testing.md](references/testing.md) |
| Local + docker operations | [references/running.md](references/running.md) |
| The AWS slice in detail | [references/infra.md](references/infra.md) |
| The credential's runtime story | `services/document-parser/docs/guides/secrets.md` |
| Every make target, annotated | `services/document-parser/docs/reference/make.md` |
| Dashboards and alerts | the `observability` skill |
