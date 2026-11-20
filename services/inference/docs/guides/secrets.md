# Secrets

Inference reads secrets from the seeded config planes, not from files in the image. `secrets.toml` is the declaration; tfctl provisions the values; the running process resolves them through AWS adapters.

## The declaration

`secrets.toml` names three secrets and a set of SSM parameters:

| Piece | Keys | Notes |
| --- | --- | --- |
| Secrets Manager | `API_KEY`, `HF_TOKEN`, `NEW_RELIC_LICENSE_KEY` | `API_KEY` and the New Relic key have a 16-char floor |
| SSM | `GRPC_PORT` … `OTEL_TRACE_SAMPLE_RATIO` | non-secret knobs, one parameter per env key |

`API_KEY` must be at least 16 characters or boot fails. `NEW_RELIC_LICENSE_KEY` is required only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — an unset endpoint is a legitimate telemetry-free boot.

## The planes

| Plane | Source | Selection |
| --- | --- | --- |
| dev | `infra/.env` plus the process env | any `ENV_TYPE` other than `prod` |
| prod | Secrets Manager + SSM under `/detectai/inference/` | `ENV_TYPE=prod`, requires `AWS_REGION` |

A key seeded on both planes is rejected at boot; the same name must not carry two values. Dev values live in `infra/.env` (gitignored); `infra/.env.example` is the template.

## Provisioning with tfctl

All verbs go through `poetry run tfctl` via the Makefile shims in `mk/secrets.mk`.

```sh
make secrets-check        # validate infra/.env and preview the plane (no terraform)
make secrets-plan         # terraform plan
make secrets-apply        # apply; interactive confirmation on AWS
make secrets-verify       # read the live plane and compare fingerprints
```

`make secrets-auto-apply` chains validate → plan → apply → verify and stops at the first failure. The seeder assumes a carrier role and prompts for MFA when needed; `secrets-session-clear` drops the cached session.

Never commit `.env`, `.env.*`, or credentials. The only declaration in git is `secrets.toml`.

## What boot does with them

`ConfigFactory` selects a provider by plane. Dev reads dotenv with environment variables winning; prod fetches the secret and the parameters, then `Settings.from_provider` validates everything into one typed object. See [specification/references/config.md](../../specification/references/config.md).

## Next

- **[Configuration](../getting-started/configuration.md)** — the resulting knobs.
- **[Testing](testing.md)** — how the prod plane is exercised locally.
