# infra/terraform — DetectAI Infrastructure (Terraform)

Manages core stateful services as code: **RDS Aurora Postgres**, **DocumentDB**, **ElastiCache Redis (x3)**, **Amazon MQ RabbitMQ**, plus **SecretsManager** contracts. App code never assembles URLs — Terraform composes `DATABASE_URL`, `MONGO_URI`, `REDIS_URL`, `RABBITMQ_URL` and emits them via `detectai/*/urls` secrets.

## Architecture & Clean Design

- **One module per bounded context** (`modules/postgres`, `modules/docdb`, `modules/elasticache`, `modules/mq`) — single responsibility, validated inputs, descriptive outputs.
- **Env separation via tfvars** (`envs/floci-local.tfvars`, `envs/floci.tfvars`, `envs/prod.tfvars`) — only endpoint, sizing, TLS diverge; same modules, same secret contract.
- **Secret contract is the API**: `detectai/pg/urls` → `DATABASE_URL`, `detectai/docdb/urls` → `MONGO_URI`, `detectai/redis/{chat,events,users}/urls`, `detectai/mq/urls` → `RABBITMQ_URL`. See `outputs.tf` for full list.
- **Provider is environment-aware**: `emulator_endpoint` (preferred) or legacy `floci_endpoint` — `null/empty = real AWS` (real creds, no skips), `http://localhost:4566 = Floci/LocalStack` (test creds, `skip_*`, `s3_use_path_style`, endpoint overrides). Works with both Floci and LocalStack on `localhost:4566`.
- **High testability**: `terraform fmt/validate`, `tests/*.tftest.hcl` with `mock_provider`, and `localhost:4566` integration plan/apply without touching real AWS.

## Prerequisites

- `terraform >= 1.9` (`versions.tf` pins `~> 1.9`, `aws ~> 5.0`, `random ~> 3.0`)
- For emulator testing: `LocalStack` or `Floci` running on `http://localhost:4566` (`curl http://localhost:4566/_localstack/health` → `{"services":{"rds":"running",...}}`)
- AWS CLI for verification (`aws --endpoint-url http://localhost:4566 ...`)

## Quick Start (Emulator — Local)

```bash
cd infra/terraform

# default: local file state, zero setup
terraform init
terraform fmt -check
terraform validate
terraform plan -var-file=envs/floci-local.tfvars
terraform apply -var-file=envs/floci-local.tfvars

# verify via emulator API
aws --endpoint-url http://localhost:4566 rds describe-db-clusters --query 'DBClusters[].DBClusterIdentifier'
aws --endpoint-url http://localhost:4566 docdb describe-db-clusters --query 'DBClusters[].DBClusterIdentifier'
aws --endpoint-url http://localhost:4566 elasticache describe-replication-groups --query 'ReplicationGroups[].ReplicationGroupId'
aws --endpoint-url http://localhost:4566 mq list-brokers --query 'BrokerSummaries[].BrokerName'
aws --endpoint-url http://localhost:4566 secretsmanager list-secrets --query 'SecretList[].Name'
# data plane (examples)
# psql "$(terraform output -raw database_url)" -c "select 1"
# mongosh "$(terraform output -raw docdb_mongo_uri)" --eval "db.runCommand({ping:1})"
# redis-cli -h $(terraform output -raw redis_chat_primary_address) -p $(terraform output -raw redis_chat_port) ping

terraform destroy -var-file=envs/floci-local.tfvars
```

## State Backends

- **Default (local file)**: `terraform.tfstate` on disk — gitignored, fine for daily `localhost:4566` work.
- **Emulator S3 (smoke-test prod flow locally)** — ephemeral, proves the switch works:
  ```bash
  aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-tfstate-local --region ap-south-1 || true
  terraform init -reconfigure -backend-config=backend.local-s3.hcl -var-file=envs/floci-local.tfvars
  terraform plan -var-file=envs/floci-local.tfvars
  ```
  See `backend.local-s3.hcl` (endpoint `http://localhost:4566`, `use_path_style=true`, skips).
- **Real AWS prod (later)**: copy `backend.prod.hcl.example` → `backend.prod.hcl`, set bucket, then:
  ```bash
  terraform init -reconfigure -backend-config=backend.prod.hcl -var-file=envs/prod.tfvars
  ```
  Prod uses encrypted, versioned S3 with `use_lockfile=true`. Never commit `backend.prod.hcl` (real bucket name).

## Variables & Environments

| File | Endpoint | Notable |
|------|----------|---------|
| `envs/floci-local.tfvars` | `http://localhost:4566` | `sslmode=disable`, `recovery_window=0`, `cache.t3.micro`, `SINGLE_INSTANCE` |
| `envs/floci.tfvars` | `https://4566-...cloudspaces.litng.ai` | same as local, remote host |
| `envs/prod.tfvars` | `null` (real AWS) | `sslmode=require`, `recovery_window=30`, `cache.r6g.large / cache.t4g.small`, `CLUSTER_MULTI_AZ`, TLS true, snapshot 7/1 |

`emulator_endpoint` is preferred; `floci_endpoint` remains as deprecated alias — locals coalesce them and treat `""` as `null` (real AWS). All identifiers, engine versions, `db_sslmode`, `secret_recovery_window`, etc. have `validation` blocks (see `variables.tf` and `modules/*/variables.tf`).

## Modules

- `modules/postgres` — `aws_rds_cluster` + `aws_rds_cluster_instance` (explicit, `urlencode` password), secrets `detectai/pg/{master,urls}`.
- `modules/docdb` — `aws_docdb_cluster` + `instance`, `MONGO_URI` with `urlencode` + `tls` param, `MONGO_MODE` derived.
- `modules/elasticache` — one `aws_elasticache_replication_group` per prefix (`chat/events/users`), declarative `secret_payloads` map (replaces ternary), preconditions enforce `num_cache_clusters`/`failover`/`multi_az` consistency, `urlencode` token, `rediss://` when TLS.
- `modules/mq` — `aws_mq_broker` (RabbitMQ), single `Users[0]`, dynamic `instances[0].endpoints[0]` → `amqps://`, `QUEUE_TYPE` via `var.queue_type` (validated `classic|quorum`).

## Testing & CI

- **Static**: `terraform fmt -check -recursive`, `terraform validate`
- **Unit (mocked)**: `terraform test` — `tests/valid.tftest.hcl` (happy paths emulator + prod) and `tests/validations.tftest.hcl` (invalid inputs expect failures) and `tests/elasticache.tftest.hcl` (HA invariants). Uses `mock_provider "aws"/"random"` — no emulator needed.
  ```bash
  terraform test
  ```
- **Integration (emulator)**: `terraform plan/apply -var-file=envs/floci-local.tfvars` against `localhost:4566` then `aws --endpoint-url http://localhost:4566 …` + data-plane checks, then `destroy`.
- **CI**: `.github/workflows/terraform.yaml` runs `fmt → init → validate → test → plan (floci-local)` on changes to `infra/terraform/**`. No `apply` in CI, no real AWS.

## Makefile (from repo root)

```bash
make tf-fmt          # terraform fmt -check
make tf-validate     # init + validate + test
make tf-plan-local   # plan with floci-local
make tf-test         # terraform test
```

## Prod Hardening Checklist (when moving to real AWS)

- `S3` backend (`backend.prod.hcl`) with versioning + encryption + lockfile.
- `secret_recovery_window=30`, `db_sslmode=require`, `docdb_tls_enabled=true`, `redis_*_transit/at_rest=true`, `snapshot 7/1`, `mq CLUSTER_MULTI_AZ`, `subnet_ids/security_groups`.
- `deletion_protection=true`, `storage_encrypted=true`, `backup_retention 7` (postgres) — can be added via vars already exposed.
- `emulator_endpoint = null` (or omit), real IAM creds via env/role, no `test` creds.

## Troubleshooting

- `Error: Invalid value for variable` → check `validation` messages in `variables.tf`.
- `automatic_failover_enabled must be false when num_cache_clusters == 1` → set `num_cache_clusters=1, automatic_failover=false, multi_az=false` for single-node (see `redis_events/users`).
- `endpoint ""` → set `emulator_endpoint = "http://localhost:4566"` for local, or `null` for prod.
- `NoSuchBucket` for S3 backend → `aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-tfstate-local`.
- State shows `Objects have changed outside Terraform` → emulator was reset; `terraform apply` will recreate.
