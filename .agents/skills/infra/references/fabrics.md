# Fabrics — the cheat sheet

Three ledgers in `infra.toml`, three modules in `terraform/modules/`, one
mocked contract-test file each. Read `infra/docs/concepts/fabrics.md` for the
diagrams and the full story.

## Queues — `[[queues]]` → `modules/queues`

The ledger splits at plan time into `terminal_queues` and `redrive_sources`:
a queue that redrives cannot read its DLQ's ARN from a block of its own, so
`terminal_key_by_name` resolves the target for `aws_sqs_queue.redrive_source`.

| Contract | Value |
|----------|-------|
| Queue type | FIFO, `content_based_deduplication = false` |
| Visibility | 300 seconds per receive attempt |
| Retention | 1,209,600 seconds (14 days), IaC-only |
| Redrive | `max_receive_count` from the ledger, target must be terminal |
| Ledger law | Redrive targets terminal — no DLQ chains, no self-redrive |

Outputs: `queue_urls`, `queue_arns`, `fabric`, `redrive_targets`. The committed
ledger carries payment-webhook's `payment_events.fifo` contract: 5 receives
then `payment_events_dlq.fifo`.

## Cache — `[[elasticache]]` → `modules/elasticache`

`aws_elasticache_serverless_cache` provisions one Redis cache per declared
entry. Serverless has no AUTH-token, node-type or cluster-mode arguments; TLS
in transit is enforced by the service.

| Contract | Value |
|----------|-------|
| Engine | Redis only, major version like `7` |
| Topology | Serverless — no nodes, failover or sharding to declare |
| Scaling | Storage ceiling 1–5000 GB, ECPU/s ceiling 1000–15000000 |
| Transport | TLS in transit, enforced by serverless; no AUTH token |
| Placement | Subnet and security group IDs from the values file |
| Consumers | Per-service key prefixes and TTLs, readers fail open |

Outputs: `addresses` (`host:port`), `endpoint_urls` (tokenless `rediss://`),
`fabric`. Shape is declared; VPC placement is plane values.

## Atlas — `[[atlas]]` → `modules/atlas`

Atlas has no emulator: tfctl sends an empty ledger on Floci, so the M0 cluster,
SCRAM user and access list are planned only on the AWS plane. The provider is
aliased as `mongodbatlas.fabric` and is never configured when the ledger is
empty.

| Contract | Value |
|----------|-------|
| Tier | `M0` (Free) only |
| Shape | `REPLICASET`, `TENANT` on `AWS`, priority 7 |
| Region | Atlas names like `AP_SOUTHEAST_2` |
| Identity | One project-scoped SCRAM user (`readWrite` on `chat_db`) |
| Access | Explicit IPv4/IPv6 CIDRs; no open default |

Outputs: `connection_uris` (sensitive `mongodb+srv://`),
`standard_connection_uris` (sensitive `mongodb://` fallback),
`access_list_cidrs`, `fabric`. The Free tier is dev/demo only — shared,
~512 MB, no backups or private endpoints, one cluster per account.

## What the tests assert

`terraform/tests/` uses `mock_provider` for both AWS and Atlas, feeds a
representative ledger through variables, and checks plan-time values only —
no apply, no network.

| File | Asserts |
|------|---------|
| `queues.tftest.hcl` | FIFO/dedup, 300s visibility, 14-day retention, one 5-attempt terminal redrive; empty ledger plans nothing |
| `elasticache.tftest.hcl` | Redis 7 serverless cache with 5 GB / 5000 ECPU/s ceilings; queue-less and fabric-less runs |
| `atlas.tftest.hcl` | M0, Atlas region, `REPLICASET`, SCRAM user, explicit CIDRs; an empty ledger plans no Atlas module |

The `fabric` output is the executable contract — update it and its test
together whenever a declared shape changes.
