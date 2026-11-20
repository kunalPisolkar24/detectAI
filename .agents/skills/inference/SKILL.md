---
name: inference
description: DetectAI's inference — the Python gRPC service that scores text with two pinned ONNX models (services/inference). Use when working anywhere in that tree — the gRPC servicer and auth, the analysis pipeline, preprocessing/engine/aggregation, model pull/load/warm, config planes or secrets tooling, the OTel facade, unit/integration tests or the k6 load rig, compose, CPU/GPU images — running, configuring, extending, or debugging the service.
---

# Inference — the text-detection service

A stateless gRPC service: submitted text goes in, an AI-vs-human verdict comes
out. Two RPCs on `inference.v1.AIService` — `Detect` (unary) and
`AnalyzeDocument` (server-streaming) — backed by two pinned ONNX models,
`spark` (fp16 bert-base) and `flare` (fp32 bert-large). There is no database,
no queue, and no session state. The boot is fail-closed: config, artifact
pull, session load, and warmup all complete before the port is bound. Current
shape: one runtime per enabled model, each with its own preprocessor, engine,
batch width, and two thread pools; per-model admission sheds load rather than
queueing minutes of work.

## Map

```text
services/inference/
├── app/
│   ├── main.py             entry point: plane, artifacts, models, runtimes, serve
│   ├── boot.py             the fail-closed boot sequence, as plain functions
│   ├── config/             typed Settings, dev/prod planes, AWS adapters
│   ├── serving/            gRPC server, x-api-key interceptor, servicer, wire mapper
│   ├── inference/          the use case: analysis, preprocessing, engine, aggregation
│   │   ├── analysis.py     admit → prepare → score in batches → aggregate
│   │   ├── preprocessing/  admission, tokenizer port, boundary cuts, overlap
│   │   ├── engine/         Engine port, ONNX adapter, guards, warmup
│   │   ├── postprocessing/ regions, verdict, weighted aggregator
│   │   └── runtime.py      one model's bundle and two pools
│   ├── models/             pull (pinned revision) and load (offline session)
│   └── observability/      OTel seam, OTLP adapters, four instruments
├── api/proto/              inference.v1 contract
├── infra/                  .env planes and compose files (cpu, gpu, ci, k6, load)
├── secrets.toml            the tfctl declaration — secrets vs SSM, committed
├── mk/ + Makefile          make targets: local / docker / tests / load / secrets
├── tests/                  unit + integration + load (k6) — a hard tree boundary
├── specification/          design history for maintainers — history, not truth
└── docs/                   the deep documentation tree
```

Dependencies point inward: serving depends on the analysis use case; the use
case depends on ports; only adapters import ONNX Runtime, Hugging Face, or AWS.

## Run it

```sh
cd services/inference
make install && make env    # poetry deps; create infra/.env — set a real API_KEY (≥ 16 chars)
make run                    # python -m app.main, gRPC on :50051
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
```

The first boot on a cold cache downloads model artifacts, so it is not
instant. Docker: `make build && make up` (`IMAGE=gpu` for the GPU image).
Probes, the first `Detect`/`AnalyzeDocument` calls, and fail-fast answers:
[references/running.md](references/running.md)

## Change the pipeline without breaking it

- Admission **rejects** blank, non-text, and over-limit submissions; text is
  never truncated or rewritten, so highlight offsets still address the text
  the client sent.
- Tokenize once. The chunk carries token IDs and character spans; a second
  pass could disagree on normalization.
- The window is `min(CHUNK_TOKEN_LIMIT, model ceiling)`; `content = window −
  2 special tokens − overlap`. Cuts land on a sentence end or a line break in
  the window's upper half. Overlap counts shared tokens, not stride.
- Engine guards refuse a call that is too wide, empty, over the ceiling, or
  the wrong output shape — no truncation, no silent degradation.
- Aggregate by `scored_tokens` weight at the threshold, one highlight span per
  region in order. Merging spans would hide a region's own probability.
- The per-model permit is the engine pool's width. An admitted document never
  queues behind another batch; a saturated model sheds with
  `RESOURCE_EXHAUSTED`.
- Errors have one mapping: input/model → `INVALID_ARGUMENT`, capacity/drain →
  `RESOURCE_EXHAUSTED`, any other fault → `INTERNAL` with a generic detail.
  Cancellation marks the span `CANCELLED`.
- Metric names are a contract — dashboards query them by name, so a rename is
  a migration, not an edit.
- Finish every change with `make test-cov` (unit + integration, 95% gate).

## Config and secrets rules

- Config is resolved **once at boot** into one typed `Settings`; changing a
  knob means a restart, never a mid-flight edit.
- The split that matters: safe numeric knobs fall back to their defaults when
  unreadable, while credentials, model pins, provider names, `ENABLED_MODELS`,
  and revisions fail the boot. No half-configured instance serves.
- `ENV_TYPE=prod` is the only prod spelling; everything else is dev. Dev =
  process env over `infra/.env`. Prod = Secrets Manager
  (`detectai/inference/secrets`) + SSM (`/detectai/inference/`), requiring
  `AWS_REGION`. A key seeded into both planes is refused.
- `x-api-key` is constant-time compared; health and dev reflection are the
  only open methods. A missing and a wrong key are indistinguishable.
- `OTEL_EXPORTER_OTLP_ENDPOINT` is the telemetry gate: unset installs
  `NullObservability` with zero SDK objects; set requires a ≥ 16-char
  `NEW_RELIC_LICENSE_KEY` or the boot fails.

## Infra and testing — the short tours

- **AWS slice:** `make env` → `make secrets-check` (always first) →
  `make secrets-plan` → `make secrets-apply` → `make secrets-verify` —
  fingerprints only, exit 1 on drift; `make secrets-auto-apply` chains
  validate → plan → apply → verify. Real-AWS verbs ride the MFA-gated seeder
  role with a cached session; the whole plane is driven by `tools/tfctl`, and
  there is no hand-rolled terraform here. Verbs, carrier/MFA behavior,
  rotation, gotchas: [references/config.md](references/config.md)
- **Tests:** `make test-unit` for logic, `make test-integration` for the real
  gRPC boot and both config planes (emulator-backed cases skip when down),
  `make test-cov` for the gate. The k6 rig is `make load-env` → `load-fixtures`
  (once per fresh tree) → `load-test` / `load-e2e`. What each really runs:
  [references/testing.md](references/testing.md)

## Observability

The telemetry build is switched by `OTEL_EXPORTER_OTLP_ENDPOINT`. When set,
traces, metrics, and logs push over OTLP/HTTP to New Relic EU; providers are
injected and the OTel globals are never touched. Instruments:
`inference_batch_size`, `inference_queue_depth`, `inference_inflight_chunks`,
and `inference_engine_duration_seconds` (attribute `model`). Span attributes:
`model.id`, `model.revision`, `inference.provider`. The service marks the span
failed for every contract status so the error share is honest, and filters
health/reflection traffic out of the panels. Shutdown closes the runtime pools
first, then drains spans → metrics → logs; gauges are maintained per request.

Boards, alerts, and the push pipeline they rely on belong to the
`observability` skill — not this one.

## Guardrails

- Never commit real `infra/.env` or `infra/.env.load` values — only the
  committed templates (`.env.example`, `.env.load.example`) enter git.
- No batching proxy or cross-request queue: batching is per-document slices,
  and the engine pool is the real capacity.
- No silent CPU fallback — the loader verifies every requested provider is
  effective. A missing device fails the boot rather than looking healthy.
- No second credential carrier (`Authorization: Bearer` twins) — one key, one
  metadata header, health and dev reflection exempt.
- Secrets verbs go through the make targets (tfctl) — no ad-hoc terraform
  against the plane.
- Do not cross service boundaries or share code between services (monorepo
  rule).
- Write documentation under `docs/` in its established style; `specification/`
  records how decisions were made — cite it, don't extend it.

## When you need depth

| Need | Go to |
|------|-------|
| Components, boot wiring, per-model runtime | `services/inference/docs/concepts/architecture.md` |
| Gates, both RPCs, errors, drain | `services/inference/docs/concepts/request-flow.md` |
| Admission, cuts, overlap, guards, aggregation | `services/inference/docs/concepts/pipeline.md` |
| Pull, revision check, load, warmup, GPU | `services/inference/docs/concepts/models.md` |
| The OTel gate and instrument inventory | `services/inference/docs/concepts/observability.md` |
| Every env key and fail-closed rule | `services/inference/docs/getting-started/configuration.md` |
| Contract fields, events, error codes | `services/inference/docs/reference/rpc-api.md` |
| What each test suite runs | [references/testing.md](references/testing.md) |
| Local + docker operations, first RPC | [references/running.md](references/running.md) |
| The config planes, secrets verbs, carrier/MFA | [references/config.md](references/config.md) |
| The engine behind the secrets verbs | the `tfctl` skill |
| Dashboards and alerts | the `observability` skill |
| Every make target, annotated | `services/inference/docs/reference/make.md` |
| The credential's runtime story | `services/inference/docs/guides/secrets.md` |
