# seed-secrets — .env → AWS Secrets Manager (Floci + real AWS)

Single source of truth: **`infra/docker/prod/.env`**. This tool reads only an allowlist of keys from that file and upserts the four app-only secrets into Secrets Manager. Terraform still owns `detectai/{pg,docdb,redis/*/mq}/urls`; this tool never touches them without `--force`.

Works against **Floci/LocalStack** (`--endpoint-url http://localhost:4566`, auto `test/test` creds) and **real AWS** (empty endpoint, IAM role, guarded by `--confirm-prod`).

## Clean architecture

```
src/
  core/            exceptions
  domain/          constants (allowlist, secret names), schemas (SeedConfig, SecretPayload)
  application/     env_parser (robust dotenv), seeder (build_payloads + sync shared keys)
  infrastructure/  secrets_manager (boto3 adapter, idempotent create/put)
  interfaces/      secrets_store (ABC)
main.py            CLI entrypoint (argparse, banner, dry-run)
```

## Usage

From repo root:

```bash
poetry -C tools/seed-secrets install --no-interaction   # or: make seed-install

# preview (never writes, safe for real AWS)
poetry -C tools/seed-secrets run python main.py --env-file infra/docker/prod/.env --endpoint-url http://localhost:4566 --dry-run
poetry -C tools/seed-secrets run python main.py --env-file infra/docker/prod/.env --endpoint-url "" --dry-run

# Floci (local) — via Makefile (poetry run under the hood)
make seed-install
make seed-floci
make seed-floci-dry

# Direct (same, no Makefile)
poetry -C tools/seed-secrets run python main.py --env-file infra/docker/prod/.env --endpoint-url http://localhost:4566 --region ap-south-1

# Real AWS (guarded)
make seed-aws
# or
poetry -C tools/seed-secrets run python main.py --env-file infra/docker/prod/.env --endpoint-url "" --region ap-south-1 --confirm-prod

# only a subset
poetry -C tools/seed-secrets run python main.py --env-file infra/docker/prod/.env --endpoint-url http://localhost:4566 --only detectai/web/secrets,detectai/gateway/secrets
# via Makefile
make seed-floci ARGS="--only detectai/web/secrets"
```

### How it reads your .env

Robust parser handles: `export KEY=`, `KEY="quoted"`, `KEY= "space before quote"`, `KEY=value # comment`, single/double quotes. Empty values are ignored. Only keys in the allowlist are seeded:

- `web` (`detectai/web/secrets`): `NEXTAUTH_SECRET, INTERNAL_API_KEY, AI_SERVICE_API_KEY, NEXT_PUBLIC_TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, NEXT_PUBLIC_PADDLE_CLIENT_TOKEN, GOOGLE_ID, GOOGLE_SECRET, GITHUB_ID, GITHUB_SECRET, PROMETHEUS_WEB_SCRAPE_TOKEN`
- `gateway` (`detectai/gateway/secrets`): `PADDLE_WEBHOOK_SECRET, INTERNAL_API_KEY`
- `workers` (`detectai/workers/secrets`): `PADDLE_API_KEY, PADDLE_ENVIRONMENT` (defaults to `sandbox`)
- `inference` (`detectai/inference/secrets`): `API_KEY` (falls back to `AI_SERVICE_API_KEY`), `HF_TOKEN`

Everything else (`DATABASE_URL`, `REDIS_URL`, `MONGO_URI`, etc.) is ignored.

### Shared-key sync

If `INTERNAL_API_KEY` / `AI_SERVICE_API_KEY` / `API_KEY` / `NEXTAUTH_SECRET` are missing, the tool generates one random value per key (`secrets.token_hex`) and writes the **same** value to every secret that needs it (web ↔ gateway ↔ inference stay in sync). Generated keys are reported by name (never by value). Add them back to your `.env` to keep them stable.

### Safety

- Refuses to overwrite Terraform-managed `detectai/{pg,docdb,redis/*/mq}/urls` without `--force`.
- Refuses to write to real AWS without `--confirm-prod` (or use `--dry-run`).
- `--dry-run` prints `secret -> status` with key counts, never values.

## Makefile wrappers (all use `poetry -C tools/seed-secrets run ...`)

```
make seed-install            # poetry install (run once)
make seed-floci              # Floci/LocalStack from SEED_FILE (default infra/docker/prod/.env)
make seed-floci-dry          # preview
make seed-aws                # real AWS (requires --confirm-prod)
make seed-dry                # preview against endpoint in AWS_ENDPOINT_URL or Floci
make prod-floci-bootstrap    # tf-apply-local + seed-floci + DATABASE_URL hint + verify
make floci-seed              # alias to seed-floci (backward compat, legacy bash)
```

## Dev

```bash
poetry -C tools/seed-secrets run pytest -q
poetry -C tools/seed-secrets run ruff check . --select F,E --ignore E501
```

## Verify

```bash
aws --endpoint-url http://localhost:4566 --region ap-south-1 secretsmanager list-secrets --query 'SecretList[].Name'
aws --endpoint-url http://localhost:4566 --region ap-south-1 secretsmanager get-secret-value --secret-id detectai/web/secrets --query SecretString
```
