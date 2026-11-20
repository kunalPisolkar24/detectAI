# Running the service — local and docker

From `services/inference` always; every verb is a make target.

## The local loop

```sh
make install    # poetry dependencies (Python 3.14)
make env        # copies infra/.env.example → infra/.env if missing (never overwrites)
make run        # python -m app.main — gRPC on :50051
```

Edit `infra/.env` after `make env`: replace the `API_KEY` placeholder with a
real value (≥ 16 characters — the boot enforces the floor). The dev plane puts
the process environment over the file, so an exported `API_KEY` wins over
`infra/.env`. Config is resolved once per boot; restart after any edit.

The first boot on a cold cache pulls and loads model artifacts, so allow time.
`make proto` regenerates the gitignored stubs in `app/serving/generated/` when
running outside a container.

## Probes and first RPCs

Health is open — no key:

```sh
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
# '' and inference.v1.AIService report SERVING
```

Dev also registers reflection, open and advertising only
`inference.v1.AIService`:

```sh
grpcurl -plaintext localhost:50051 list
```

Both RPCs need the key. Load it from the dev plane first:

```sh
set -a; . infra/.env; set +a
grpcurl -plaintext -H "x-api-key: $API_KEY" \
  -d '{"text":"A short document.","model_id":"spark"}' \
  localhost:50051 inference.v1.AIService/Detect
grpcurl -plaintext -H "x-api-key: $API_KEY" \
  -d '{"text":"A longer document with several sentences.","model_id":"spark"}' \
  localhost:50051 inference.v1.AIService/AnalyzeDocument
```

`Detect` answers one `DetectionResult`; `AnalyzeDocument` emits `started`,
up to 20 coalesced `progress` events, then `result` with the same verdict.
Confidences are 0–100 percentages; an empty `model_id` selects `spark`.

## Docker

```sh
make build            # cpu image by default
make up               # compose up detached; reads infra/.env
make down
make build IMAGE=gpu && make up IMAGE=gpu   # GPU image + device reservation
```

The GPU image swaps in `onnxruntime-gpu` and `compose.gpu.yml` requests an
NVIDIA device. If the requested provider is not effective, the boot fails —
there is no quiet fallback to CPU.

## Fail-fast answers

| Boot refuses | Because | Fix |
|--------------|---------|-----|
| short or missing `API_KEY` | the credential is validated at boot | set a real ≥ 16-char value in `infra/.env` |
| unknown `ENABLED_MODELS` name | a process only serves models it can pull and load | use `spark`, `flare`, or both |
| model revision is not a 40-char SHA | the pin is the artifact's identity | restore the pinned value from the template |
| unknown `INFERENCE_PROVIDERS` name | the loader would silently ignore it | use a valid ORT provider name |
| OTLP endpoint set without a license key | telemetry must never boot half-wired | provide `NEW_RELIC_LICENSE_KEY` or unset the endpoint |
| artifact missing or wrong revision on disk | a stale volume must not serve an old build | let the pull complete, or clear `MODEL_CACHE_DIR` |
| requested provider not effective | a silent CPU fallback would look healthy | supply the device or drop the provider from the list |

A `RESOURCE_EXHAUSTED` at runtime is not a boot problem: the model is at
capacity and the service is shedding by design. See
[testing the service](testing.md).

## Where everything is configured

| Target | Config file |
|--------|-------------|
| the service (`run`, `up`) | `infra/.env` — from `.env.example` |
| the load/e2e rig | `infra/.env.load` — from `.env.load.example` |
| the AWS secrets slice | `infra/.env` again (tfctl reads it) |

[Back to the briefing](../SKILL.md)
