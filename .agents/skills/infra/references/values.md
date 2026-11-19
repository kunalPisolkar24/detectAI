# Values — declaration, env, plane

Two files drive every run: committed `infra.toml` (shape) and gitignored
`envs/.env` (plane values). `docker/*/.env` sets local ports only. Full key
tables: `infra/docs/getting-started/configuration.md`.

## The declaration

`[service]` plus up to three ledger sections; at least one ledger required.
Unknown sections, fields and duplicate names are errors.

| Section | Fields | Defaults when omitted |
|---------|--------|-----------------------|
| `[service]` | `slug` (must be `infra`), `region` | `ap-southeast-2` |
| `[[queues]]` | `name`, `dlq`, `max_receive_count` | `""`, `0` |
| `[[elasticache]]` | `name`, `engine`, `engine_version`, `node_type`, `num_cache_nodes`, `port`, `parameter_group_name` | `redis`, `7.0`, `cache.t3.micro`, `1`, `6379`, version-matched group |
| `[[atlas]]` | `name`, `region`, `tier` | `tier = "M0"`; region required |

Rules the loader enforces:

- Queue names are `[A-Za-z0-9_-]{1,75}.fifo`, unique within the ledger.
- A `dlq` must be declared in the same ledger; it needs
  `max_receive_count` 1–1000; no self-redrive; targets are terminal.
- Cache names are `[a-z][a-z0-9-]{0,39}`, unique; 1–6 nodes; port 1–65535;
  engine must be `redis`.
- Atlas names follow the cache name law; regions look like `AP_SOUTHEAST_2`;
  tier must be `M0`.

## The values file

`make env` copies `.env.example` → `envs/.env` if missing. Values are required
only when their fabric is declared; the queue fabric needs no credentials.

| Key | Fabric | Rule |
|-----|--------|------|
| `AWS_REGION` | all | Plain region code; overrides the declaration's region |
| `REDIS_AUTH_TOKEN` | cache | ≥ 16 characters |
| `CACHE_SUBNET_IDS` | cache | Comma-separated subnet IDs; required |
| `CACHE_SECURITY_GROUP_IDS` | cache | Optional comma-separated IDs |
| `MONGODB_ATLAS_PUBLIC_KEY` | Atlas | ≥ 8 characters |
| `MONGODB_ATLAS_PRIVATE_KEY` | Atlas | ≥ 16 characters |
| `MONGODB_ATLAS_PROJECT_ID` | Atlas | 24-character hex |
| `ATLAS_DB_USERNAME` | Atlas | Non-empty |
| `ATLAS_DB_PASSWORD` | Atlas | ≥ 16 characters |
| `ATLAS_IP_CIDRS` | Atlas | Comma-separated IPv4/IPv6 CIDRs; required |

With the committed declaration all three ledgers are present, so the full set
is required on the first run. tfctl passes them as `TF_VAR_*` entries; secret
values never print in its receipts.

## The plane switch

`PLANE=floci|aws` on every fabric verb; anything else stops before tfctl runs.

| | Floci (default) | Real AWS |
|---|---|---|
| Endpoints | `http://localhost:4566` for SQS + ElastiCache | Region defaults |
| Apply | Auto-approved | Interactive confirmation |
| State | Emulator S3 bucket | Versioned S3 in the caller's account |
| Carrier | Emulated account | `detectai-infra-seeder`, MFA-gated, cached 12 h |
| Atlas | Real MongoDB Cloud, state on Floci | Real MongoDB Cloud |

Floci must be running (`make -C .. floci-up` from `infra/`): the plan probes
`/_localstack/health` with a 2-second timeout and fails with a start hint.

## Local twin ports

| Twin | `.env` source | Keys / defaults |
|------|---------------|-----------------|
| ElasticMQ | `docker/elasticmq/.env.example` | `ELASTICMQ_PORT=9324`, `ELASTICMQ_UI_PORT=3001` |
| MongoDB | `docker/mongo/.env` | `MONGO_PORT=27017` |
| Redis | `docker/redis/.env` | `REDIS_PORT=6379` |

The compose files declare no networks or container names, so services can
include them without collisions.
