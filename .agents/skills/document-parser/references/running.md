# Running the service — local and docker

From `services/document-parser` always; every verb is a make target.

## The local loop

```sh
make install    # poetry dependencies (Python 3.14)
make env        # copies infra/.env.example → infra/.env if missing (never overwrites)
make run        # uvicorn --reload on :8000 — code changes hot-reload
```

Edit `infra/.env` after `make env`: replace the `API_KEY` placeholder with a
real value (≥ 16 characters — the boot enforces the floor). Every other key
has a working default. Restart after any edit: config is resolved once per
boot. The dev plane puts the process environment over the file, so an
exported `API_KEY` wins over `infra/.env`.

## Probes and first extraction

Both probes are open — no key, identical across runtimes:

```sh
curl http://localhost:8000/api/v1/health
# {"status":"ok"}
curl http://localhost:8000/api/v1/ready
# {"status":"ready"}
```

```sh
curl -X POST http://localhost:8000/api/v1/extract \
  -H "x-api-key: <your-key>" \
  -F "file=@./a-document.pdf"
# 200: {"filename":"a-document.pdf","content_type":"application/pdf",
#       "text_length":15234,"text":"…","truncated":false}
```

`content_type` in the response is the **sniffed** MIME, not whatever the
upload declared.

## Docker

```sh
make build            # image detectai-document-parser
PORT=8000 make up     # compose up detached; the shell PORT wins over the env file's
make logs             # follow the stack
make ps               # is it even up?
make down             # stop it
```

The compose stack reads `infra/.env` wholesale, so local and docker answer
the same config. The difference is only hot reload — code changes that is
what `make run` is for.

## Fail-fast answers

| Boot refuses | Because | Fix |
|--------------|---------|-----|
| missing or short `API_KEY` (< 16 chars) | the credential is validated at boot, not per request | set a real value in `infra/.env`, rerun |
| OTel endpoint set but `NEW_RELIC_LICENSE_KEY` missing/short | telemetry must never boot half-wired | provide the key or unset `OTEL_EXPORTER_OTLP_ENDPOINT` to go null-build |
| anything silently defaulted that you expected differently | every knob is documented | `services/document-parser/docs/getting-started/configuration.md` |

A `503` on `/ready` under load testing is backpressure by design, not a
failure — see the load rig in [running the tests](testing.md).

## Where everything is configured

| Target | Config file |
|--------|-------------|
| the service (`run`, `up`) | `infra/.env` — from `.env.example` |
| the load/e2e rig | `infra/.env.load` — from `.env.load.example` |
| the AWS slice | `infra/.env` again (the terraform pipeline reads it) |

[Back to the briefing](../SKILL.md)
