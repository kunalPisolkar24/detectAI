# infra — the shared fabrics as code

This directory terraform-drives the infrastructure the services share, via
tfctl's `infra` kind — full documentation in [docs/](docs/README.md).
`infra.toml` is the exhaustive ledger of **which fabrics
exist**: `[[queues]]` for SQS, `[[elasticache]]` for the shared Redis cache, and
`[[atlas]]` for a MongoDB Atlas Free (M0) cluster. Each section is optional — a
fabric is planned only when its ledger has entries, so you can stand up any
combination from the same stack. At least one fabric must be declared.

The queue ledger carries the payment-webhook contract from
`services/payment-webhook/specification/messaging.md` — `payment_events.fifo`
with a 300s visibility timeout, 14-day retention, and a redrive into
`payment_events_dlq.fifo` after 5 failed receives. Redrive targets must be
terminal; DLQ chains are not modeled.

The cache ledger carries the contract in
`services/chats/specification/references/cache.md`: one shared ElastiCache
Serverless Redis cache per environment, with TLS in transit and no AUTH token.
Consumers isolate their keys with per-service prefixes (`web:`, `chats:`,
`worker:`, `inference:`); every key has a TTL, and readers fail open to the
source store. Cache shape (name, engine, major version, usage limits) is
declared here; VPC placement is plane-specific values in `envs/.env`.

The Atlas ledger pins one cluster to the `M0` Free tier on AWS-backed Atlas
regions. Atlas has no emulator and is AWS-only: tfctl ignores `[[atlas]]` on
Floci, so no cluster is planned there and no API is called. The Atlas API keys, project ID, SCRAM
user, password, and explicit IPv4/IPv6 access-list CIDRs are plane values in
`envs/.env`, never committed. The stack exposes a sensitive `mongodb+srv://`
connection URI for chats' `MONGO_URI` (plus a `mongodb://` fallback). Atlas is
for dev/demo only: Free tier is shared, ~512 MB, has no backups or private
endpoints, and there is one free cluster per account.

Services stay endpoint-agnostic: `QUEUE_URL` / `AWS_ENDPOINT_URL_SQS`,
`REDIS_ENDPOINT`, and `MONGO_URI` / `MONGO_DATABASE` decide
which twin they talk to — the compose files under `infra/docker` in local dev,
these fabrics on Floci or real AWS. Queue, cache and Atlas names are each
ledger's identity; two fabrics may not share a name within their own ledger.

## Start here

```bash
cd infra

make env                    # create envs/.env from .env.example (never overwrites)
make fmt init validate test # offline gate: format, validate, mocked tests — no plane
make plan && make apply     # land the declared fabrics (auto-approved apply on floci)
make destroy                # tear it all down (auto-approved on both planes)
```

`PLANE` picks the state plane in every tfctl target: `floci` (default, the
emulator on :4566) or `aws` (real AWS). The state bucket
(`detectai-infra-tfstate-<account>`) and the `detectai-infra-seeder` carrier
role are created on demand by the first run that needs them.

## Layout

```text
infra/
├── infra.toml          the declaration: the exhaustive fabric ledgers
├── terraform/          the terraform root tfctl drives
│   ├── modules/queues/       the SQS fabric
│   ├── modules/elasticache/  the shared Redis fabric
│   ├── modules/atlas/        the MongoDB Atlas Free fabric
│   └── tests/                mocked contract tests for all fabrics, plus standalone cases
├── envs/.env           the values file (gitignored; .env.example is the template)
├── mk/                 the make targets: fabrics.mk drives tfctl, tests.mk the offline gate
└── docker/             the local service twins (ElasticMQ, Redis) — this root never touches them
```

The offline gate never needs a plane: `terraform test` runs provider mocks and
asserts each fabric's contract, including queue-only, cache-only, Atlas-only,
an empty Atlas ledger, and empty runs. Beyond it, the integration suite
(`poetry -C ../tools/tfctl run pytest -m integration`) plans read-only against
the shared persistent namespace on the emulator — nothing there applies or
destroys. Real AWS is reached only through an explicit `make PLANE=aws …`.
