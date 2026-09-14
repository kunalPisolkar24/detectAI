# seed-secrets — .env → AWS Secrets Manager (Floci + real AWS)

Single source of truth: **`infra/docker/prod/.env`**. This tool reads only an allowlist of keys from that file and upserts the app-only secrets into Secrets Manager. Terraform still owns `detectai/{pg,docdb,redis/*/mq}/urls`; this tool never touches them without `--force`.

Works against **Floci/LocalStack** (`--endpoint-url http://localhost:4566`, auto `test/test` creds) and **real AWS** (empty endpoint, IAM role, guarded by `--confirm-prod`).

## Clean architecture

```
src/
  core/             exceptions (SeedException/ConfigError/EnvParseError/SecretsWriteError/GuardError), constants (EXIT_CODE_*), logging (redact, configure)
  domain/           constants (allowlist, secret names), schemas (SeedConfig/SecretPayload — pure Pydantic, no FS I/O)
  interfaces/       secrets_store (ISecretsStore), env_loader (IEnvLoader)
  application/      dto (SeedCommand/SeedResult), env_parser (pure parse_env_content), use_cases (SeedUseCase with injected key_gen)
  infrastructure/
    config/         Settings + provider (lru_cache, clear for tests, empty→None)
    filesystem/     LocalEnvLoader — the ONLY place that touches Path.exists/open
    secrets_manager Boto3SecretsManager — injectable client, redacted errors, idempotent create/put
    composition/    container — sole wiring place (build_seeder/build_secrets_store/build_env_loader)
  cli/              parser (argparse, testable, --verbose)
main.py             thin bootstrap: parse args -> get_settings -> build_seeder -> load env -> seed -> banner
```

Dependency rule: `domain <- application <- infrastructure`, `main -> composition -> all`. Domain never imports infra; `infrastructure/filesystem` is the only FS boundary.

## Setup

```bash
poetry -C tools/seed-secrets install --no-interaction   # or: make -C tools/seed-secrets install
# optional local overrides
cp tools/seed-secrets/.env.example tools/seed-secrets/.env  # AWS_ENDPOINT_URL, AWS_REGION, ENV_FILE
```

### Environment

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `AWS_ENDPOINT_URL` / `endpoint_url` | no | `None` (real AWS) | `http://localhost:4566` for Floci |
| `AWS_REGION` / `region` | no | `ap-south-1` |  |
| `ENV_FILE` | no | `infra/docker/prod/.env` | alternative dotenv path |

Empty strings are ignored. Settings are validated via Pydantic (non-empty `env_file`, known secret names for `--only`).

## Usage

From repo root:

```bash
poetry -C tools/seed-secrets install --no-interaction   # or: make seed-install

# preview (never writes, safe for real AWS)
poetry -C tools/seed-secrets run python main.py --env-file infra/docker/prod/.env --endpoint-url http://localhost:4566 --dry-run
poetry -C tools/seed-secrets run python main.py --env-file infra/docker/prod/.env --endpoint-url "" --dry-run

# via per-tool Makefile (poetry run under the hood)
make -C tools/seed-secrets dry-run
make -C tools/seed-secrets seed-floci
poetry -C tools/seed-secrets run python main.py --env-file infra/docker/prod/.env --endpoint-url http://localhost:4566 --region ap-south-1 --verbose

# Real AWS (guarded)
poetry -C tools/seed-secrets run python main.py --env-file infra/docker/prod/.env --endpoint-url "" --region ap-south-1 --confirm-prod

# only a subset
poetry -C tools/seed-secrets run python main.py --env-file infra/docker/prod/.env --endpoint-url http://localhost:4566 --only detectai/web/secrets,detectai/gateway/secrets
```

### Root Makefile wrappers (all use `poetry -C tools/seed-secrets run ...`)

```
make seed-install            # poetry install (run once)
make seed-floci              # Floci/LocalStack from SEED_FILE (default infra/docker/prod/.env)
make seed-floci-dry          # preview
make seed-aws                # real AWS (requires --confirm-prod)
make seed-dry                # preview against endpoint in AWS_ENDPOINT_URL or Floci
```

### Per-tool Makefile

```
make -C tools/seed-secrets install
make -C tools/seed-secrets lint        # ruff check
make -C tools/seed-secrets test        # unit
make -C tools/seed-secrets test-all    # unit + integration
make -C tools/seed-secrets test-cov    # unit + coverage gate 70
make -C tools/seed-secrets dry-run     # Floci dry-run
make -C tools/seed-secrets seed-floci  # Floci write
```

### How it reads your .env

Robust parser handles: `export KEY=`, `KEY="quoted"`, `KEY= "space before quote"`, `KEY=value # comment`, single/double quotes. Empty values are ignored. Only keys in the allowlist are seeded:

- `web` (`detectai/web/secrets`): `NEXTAUTH_SECRET, INTERNAL_API_KEY, AI_SERVICE_API_KEY, NEXT_PUBLIC_TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, NEXT_PUBLIC_PADDLE_CLIENT_TOKEN, GOOGLE_ID, GOOGLE_SECRET, GITHUB_ID, GITHUB_SECRET, PROMETHEUS_WEB_SCRAPE_TOKEN`
- `gateway` (`detectai/gateway/secrets`): `PADDLE_WEBHOOK_SECRET, INTERNAL_API_KEY`
- `workers` (`detectai/workers/secrets`): `PADDLE_API_KEY, PADDLE_ENVIRONMENT` (defaults to `sandbox`)
- `inference` (`detectai/inference/secrets`): `API_KEY` (falls back to `AI_SERVICE_API_KEY`), `HF_TOKEN`

Everything else (`DATABASE_URL`, `REDIS_URL`, `MONGO_URI`, etc.) is ignored.

### Shared-key sync

If `INTERNAL_API_KEY` / `AI_SERVICE_API_KEY` / `API_KEY` / `NEXTAUTH_SECRET` are missing, the tool generates one random value per key (`secrets.token_hex` via injectable `key_gen`) and writes the **same** value to every secret that needs it (web ↔ gateway ↔ inference stay in sync). Generated keys are reported by name (never by value). Add them back to your `.env` to keep them stable. Use `--dry-run` to preview.

### Safety

- Refuses to overwrite Terraform-managed `detectai/{pg,docdb,redis/*/mq}/urls` without `--force`.
- Refuses to write to real AWS without `--confirm-prod` (or use `--dry-run`).
- `--dry-run` prints `secret -> status` with key counts, never values.
- Errors are redacted (no secret values in messages) and carry `secret_name` context.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | success |
| `2` | usage/config (bad args, missing env file, guard blocked, unknown secret) |
| `1` | runtime (AWS write failed) |

## Dev

```bash
make -C tools/seed-secrets lint
make -C tools/seed-secrets test
make -C tools/seed-secrets test-all
make -C tools/seed-secrets test-cov   # fail-under 70
poetry -C tools/seed-secrets run ruff format .  # format
```

Tests use `FakeStore(ISecretsStore)` with injected `key_gen=lambda n: "a"*2*n` for deterministic generation — no network, no AWS creds. Integration tests use `tmp_path + LocalEnvLoader` and `MagicMock(boto3 client)` for idempotent `describe->put|create` + race `ResourceExists` branches.

## Verify

```bash
aws --endpoint-url http://localhost:4566 --region ap-south-1 secretsmanager list-secrets --query 'SecretList[].Name'
aws --endpoint-url http://localhost:4566 --region ap-south-1 secretsmanager get-secret-value --secret-id detectai/web/secrets --query SecretString
```

## CI

`tools-seed-secrets.yaml` runs on `staging`/`main` (path-filtered `tools/seed-secrets/**`) — `ruff + pytest --cov --cov-fail-under=70` (unit) + `pytest -m integration`. Feature branches target `dev` (no CI) — paste local `make lint/test` output in PR.

## Legacy

`src/application/seeder.py:Seeder` is kept as a shim re-exporting `SeedUseCase`; prefer `use_cases.SeedUseCase` and `container.build_seeder`.
