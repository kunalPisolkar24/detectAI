# infra — the shared queue fabric as code

This directory terraform-drives the SQS queues the services share, via tfctl's
`infra` kind. The queue ledger is the declaration (`infra.toml`): every queue
the fabric owns, plus which queue redrives into which DLQ at which receive
budget. The terraform root (`terraform/`) turns the ledger into queues; today
it carries the payment-webhook contract from
`services/payment-webhook/specification/messaging.md` — `payment_events.fifo`
with a 300s visibility timeout, 14-day retention, and a redrive into
`payment_events_dlq.fifo` after 5 failed receives. Redrive targets must be
terminal; DLQ chains are not modeled.

Services stay endpoint-agnostic: `QUEUE_URL` plus `AWS_ENDPOINT_URL_SQS` decide
which twin they talk to — the ElasticMQ compose under `infra/docker` in local
dev, this fabric on floci or real AWS. Producers send an explicit
`MessageDeduplicationId` per event, so the fabric is declared with
content-based deduplication off. Queue names, not ARNs, are the ledger's
identity; two queues may not share a name.

## Start here

```bash
cd infra

make env                    # create envs/.env from .env.example (never overwrites)
make fmt init validate test # offline gate: format, validate, mocked tests — no plane
make plan && make apply     # land the fabric (auto-approved apply on floci)
make destroy                # tear it all down (auto-approved on both planes)
```

`PLANE` picks the state plane in every tfctl target: `floci` (default, the
emulator on :4566) or `aws` (real AWS — set `TF_STATE_BUCKET` in `envs/.env`
first). The state bucket and the `detectai-infra-seeder` carrier role are
created on demand by the first run that needs them.

## Layout

```text
infra/
├── infra.toml          the declaration: the exhaustive queue ledger
├── terraform/          the terraform root tfctl drives (modules/queues holds the fabric)
├── envs/.env           the values file (gitignored; .env.example is the template)
├── mk/                 the make targets: queues.mk drives tfctl, tests.mk the offline gate
└── docker/             the local ElasticMQ twin for service dev — this root never touches it
```

The offline gate never needs a plane: `terraform test` runs provider mocks
(`terraform/tests/queues.tftest.hcl` asserts the ledger's contract shape).
Beyond it, the fabric is proven on floci only — the integration
(`poetry -C ../tools/tfctl run pytest -m integration`) applies an `itn_`-sandbox
copy of the ledger to the emulator, asserts the live queue attributes, tags,
and a message round-trip, then destroys with the state purge. Real AWS is
reached only through an explicit `make PLANE=aws …`.
