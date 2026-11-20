# Config, planes, and the secrets verbs

Config is resolved once at boot and frozen. Changing a knob means a restart.

## Plane selection

Only an exact `ENV_TYPE=prod` selects prod — anything else, including a value
from a file, is dev. The choice comes from the process environment, never from
AWS or a file.

| Plane | Source | Notes |
|-------|--------|-------|
| dev | process env over `infra/.env` | `DOTENV_PATH` overrides the file path; a missing file is an empty plane |
| prod | Secrets Manager `detectai/inference/secrets` + SSM `/detectai/inference/` | requires `AWS_REGION`; a key seeded into both planes fails the boot |

`ConfigFactory.create(plane)` builds the provider; `Settings.from_provider`
reads and validates every field once. Nothing reads the environment afterwards.

## Fail-closed rules

| Input | Behavior |
|-------|----------|
| Bad `GRPC_PORT`, log level, text limit, chunk limit | fall back to the default |
| Bad batch width, concurrency knobs, threshold, threads | fall back to the default |
| Negative or unparseable `CHUNK_TOKEN_OVERLAP` | fall back to 0 |
| `ENABLED_MODELS` unknown, empty, or duplicated | boot failure; canonical order enforced |
| Unknown `INFERENCE_PROVIDERS` name | boot failure; at least one required |
| Model revision not a 40-char lowercase SHA | boot failure |
| `API_KEY` shorter than 16 characters | boot failure |
| OTLP endpoint set without `NEW_RELIC_LICENSE_KEY` | boot failure |
| A key seeded into both planes | boot failure |

The rule is simple: a knob that can be safely ignored falls back; an identity
or credential that cannot be guessed fails the boot.

## Knob groups

| Group | Keys |
|-------|------|
| Transport | `API_KEY`, `GRPC_PORT`, `LOG_LEVEL` |
| Admission | `MAX_TEXT_CHARS`, `MAX_INFLIGHT_REQUESTS` |
| Chunking | `CHUNK_TOKEN_LIMIT`, `CHUNK_TOKEN_OVERLAP` |
| Batching | `INFERENCE_BATCH_SIZE`, `FLARE_BATCH_SIZE`, `SPARK_BATCH_SIZE`, `MAX_CONCURRENT_BATCHES` |
| Models | `ENABLED_MODELS`, `MODEL_CACHE_DIR`, per-model `*_MODEL_REPO`, `*_MODEL_REVISION`, `*_MODEL_DIR`, `*_MAX_SEQUENCE_LENGTH` |
| Execution | `INFERENCE_PROVIDERS`, `ORT_INTRA_OP_THREADS` |
| Verdict | `AI_DETECTION_THRESHOLD` |
| Telemetry | `OTEL_EXPORTER_OTLP_ENDPOINT`, `NEW_RELIC_LICENSE_KEY`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_VERSION`, `OTEL_TRACE_SAMPLE_RATIO` |

Useful relationships: the per-model batch size overrides the global one;
`MAX_CONCURRENT_BATCHES` is both the engine pool width and the per-model
admission permit; the text bound rejects rather than truncates.

## Secrets and tfctl

`secrets.toml` is the committed declaration: `API_KEY`, `HF_TOKEN`, and
`NEW_RELIC_LICENSE_KEY` in Secrets Manager; the remaining knobs as SSM
parameters. Only `infra/.env.example` and `.env.load.example` enter git —
never the filled-in `.env` files.

```sh
make secrets-check        # validate infra/.env, preview the plane (no terraform)
make secrets-plan         # terraform plan
make secrets-apply        # apply; interactive confirmation on AWS
make secrets-verify       # compare the live plane against infra/.env by fingerprint
make secrets-auto-apply   # validate → plan → apply → verify, stopping at the first failure
```

Every verb goes through `tools/tfctl`; never run bare `terraform init` against
the secrets stack. Real-AWS verbs assume the MFA-gated seeder role and cache
the session in `tools/tfctl/.session-cache/` — a plan → apply stretch prompts
once. `secrets-session-clear` drops the cached session;
`secrets-session-clear-all` and `secrets-session-refresh-all` work across
services. Teardown: `secrets-clean` keeps state, `secrets-destroy` removes
everything including the seeder role. The engine and its carrier are covered
by the `tfctl` skill.

## CPU and GPU

| | CPU (default) | GPU |
|---|---------------|-----|
| Image target | `cpu` | `gpu` |
| Runtime | `onnxruntime` | `onnxruntime-gpu` |
| Providers | `CPUExecutionProvider` | CUDA-first list from `compose.gpu.yml` |
| Reservation | none | NVIDIA device via Compose |

`INFERENCE_PROVIDERS` is an ordered preference list; the loader verifies every
requested provider is effective, so a missing device fails the boot instead of
silently degrading. Both pinned artifacts are configured at a 512-token
ceiling, cross-checked against what the artifact declares.

## Key files

| File | Role |
|------|------|
| `app/config/settings.py` | the typed `Settings` and every validator |
| `app/config/provider.py` | the `ConfigProvider` port |
| `app/config/factories/` | dev/prod provider construction and AWS client |
| `app/config/adapters/` | dotenv, Secrets Manager, SSM reads |
| `secrets.toml` | the tfctl declaration |

For the full resolution rules see
`services/inference/specification/references/config.md`; for the user-facing
table see `services/inference/docs/getting-started/configuration.md`.

[Back to the briefing](../SKILL.md)
