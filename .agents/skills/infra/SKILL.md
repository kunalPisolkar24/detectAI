---
name: infra
description: DetectAI's infra — the shared fabrics as code in infra/ (SQS queues, ElastiCache Redis, MongoDB Atlas Free) driven by tfctl's infra kind, plus the local Docker twins. Use when working anywhere in that tree — the infra.toml ledgers, envs/.env values and plane switch, the terraform modules and mocked contract tests, the make targets, or the ElasticMQ / MongoDB / Redis compose stacks — to plan, apply, extend, or debug the shared fabrics. For the tfctl engine, carrier, sessions, or verbs, use the tfctl skill; for dashboards and alerts, use the observability skill.
---

# Infra — the shared fabrics as code

`infra/` terraform-drives the infrastructure the services share through tfctl's
`infra` kind. `infra.toml` is the exhaustive ledger of **which fabrics exist**:
`[[queues]]` for SQS, `[[elasticache]]` for the shared Redis cache, and
`[[atlas]]` for a MongoDB Atlas Free cluster. Each section is optional, but at
least one must be declared. Shape lives in the declaration; credentials and
placement live in the gitignored `envs/.env`. The `docker/` twins are plain
compose stacks for local development — the Terraform root never touches them.

Current shape: three declared ledgers, three count-gated modules, one mocked
contract-test file per fabric, and a make layer split between the offline gate
and the plane verbs. The canonical documentation tree is `infra/docs/`.

## Map

```text
infra/
├── infra.toml             the declaration: which fabrics exist and their shape
├── envs/.env              gitignored values from .env.example (plane-specific)
├── terraform/
│   ├── versions.tf        Terraform + provider versions, partial S3 backend
│   ├── providers.tf       AWS emulator switching + the aliased Atlas provider
│   ├── variables.tf       inputs, validation, defaults
│   ├── main.tf            the three count-gated module calls
│   ├── outputs.tf         endpoints plus each fabric's `fabric` contract output
│   ├── modules/           queues / elasticache / atlas (main, variables, outputs)
│   └── tests/             one mocked contract-test file per fabric
├── docker/                local twins: elasticmq (+UI) / mongo / redis
├── mk/tests.mk            the offline gate: env, fmt, init, validate, test
├── mk/fabrics.mk          the plane verbs: plan, apply, destroy, session-*, seeder-drop
├── docs/                  canonical docs: quickstart, concepts, guides, reference
└── README.md              stack overview
```

## How a fabric is declared

The declaration is exhaustive and validated before any values are read:

- The name is the identity inside its ledger — declare it once.
- A `dlq` must name a queue in the same ledger and requires
  `max_receive_count` (1–1000). Redrive targets are terminal: no DLQ chains,
  no queue redriving to itself.
- Cache: Redis only, lowercase DNS-style names, major version like `7`,
  storage 1–5000 GB, throughput 1000–15000000 ECPU/s.
- Atlas: `M0` only, Atlas-style region names (`AP_SOUTHEAST_2`), explicit
  IPv4/IPv6 CIDRs — the free tier has no private endpoints.
- An empty ledger plans no module; the `count` gate removes it entirely.

Declaration schemas, defaults and the exact validation rules:
[references/values.md](references/values.md)

## Run it

```sh
cd infra
make env                       # envs/.env from the example — only if missing
make fmt init validate test    # offline gate: no plane, no credentials
make -C .. floci-up            # emulator on :4566 (repo root target)
make plan && make apply        # land the declared fabrics
make destroy                   # tear down Terraform-managed resources
```

`PLANE=floci|aws` selects the plane on every fabric verb; `floci` is the
default. Apply is auto-approved on Floci and interactive on real AWS; destroy
auto-approves on both. State lives in the derived
`detectai-infra-tfstate-<account>` bucket and every acting verb rides the
`detectai-infra-seeder` role — both created on demand, no bootstrap step.

**Read the plan before applying.** Floci emulates the AWS fabrics but Atlas has
no emulator: tfctl ignores `[[atlas]]` on Floci entirely, so local plans make
no MongoDB Cloud calls. Atlas is real MongoDB Cloud on the AWS plane only.
Full command tour and failure modes:
[references/operations.md](references/operations.md)

## Change a fabric without breaking it

- **Queues** — FIFO, content-based deduplication off (producers send an
  explicit `MessageDeduplicationId`), 300s visibility, 14-day retention.
  Redrive needs a separate resource because a queue cannot read its own DLQ's
  ARN; the target must be terminal.
- **Cache** — one `aws_elasticache_serverless_cache` per declared entry. Redis
  only, TLS in transit enforced by serverless, no AUTH token. Storage and ECPU
  ceilings are declared; subnet and security group IDs are plane values.
- **Atlas** — `M0` tenant replica set on AWS, one project-scoped SCRAM user,
  explicit access-list CIDRs. Outputs a sensitive `mongodb+srv://` URI and a
  `mongodb://` fallback for SRV-less networks.
- Every module emits a plan-time `fabric` output; the mocked tests assert it.
  Change `terraform/tests/<fabric>.tftest.hcl` alongside any shape change.

Resources, outputs and test assertions per fabric:
[references/fabrics.md](references/fabrics.md)

## Config and values

Shape is committed (`infra.toml`), values are not (`envs/.env`, template in
`.env.example`). Values are only required for fabrics that are actually
declared: the queue fabric needs none; cache needs `CACHE_SUBNET_IDS`;
Atlas needs the API keys, 24-hex project ID,
SCRAM user, ≥16-char password and explicit CIDRs. `AWS_REGION` overrides the
declaration's region. Floci sets the emulator endpoint; real AWS uses region
defaults. `docker/*/.env` holds only local port overrides.

## Docker twins — the short tour

| Twin | Host port | State | Stands in for |
|------|-----------|-------|---------------|
| `elasticmq/` | 9324 (UI 3001) | in memory | SQS queues + redrive |
| `mongo/` | 27017 | `mongo_data` volume | the document store |
| `redis/` | 6379 | none | the shared cache |

They are standalone, network-free compose stacks that services can include in
their own compose files. Known gaps: ElasticMQ keeps content-based dedup on
and sets no retention; local Redis has no AUTH or encryption; there is no Atlas
twin. Services reach either destination through `QUEUE_URL`, `REDIS_ENDPOINT`
and `MONGO_URI`.

## Test and verify

`make fmt init validate test` is the offline gate and the PR gate —
`init` clears the recorded backend first, then initializes with
`-backend=false`. Beyond it, `poetry -C ../tools/tfctl run pytest -m
integration` plans read-only against the shared Floci namespace; it applies
and destroys nothing. Real AWS is reached only by explicit `PLANE=aws` verbs.

## Guardrails

- Never commit real `envs/.env` values — only `.env.example` enters git.
- Never hand-run terraform against this stack: tfctl composes the backend
  config (there are no `backend.*.hcl` files), so a bare `init` is invalid.
- The declaration is the exhaustive allowlist — fix a fabric by editing it,
  not by hand-creating matching resources on a plane.
- Review every plan before apply: Atlas is real MongoDB Cloud on the AWS plane only.
- The offline gate is the PR gate — `dev` runs no CI, so never leave it red.
- Do not reach into `observability/` (a separate stack root) or service code
  from here; the shared fabrics end at the emitted endpoints.
- Secrets print only as lengths and fingerprints in tfctl receipts — keep it
  that way in anything you add.

## When you need depth

| Need | Go to |
|------|-------|
| First run, offline gate, first apply | `infra/docs/getting-started/quickstart.md` |
| Declaration, every value key, plane flick | `infra/docs/getting-started/configuration.md` |
| Component map, verb lifecycle, two planes | `infra/docs/concepts/architecture.md` |
| Fabric resources and contracts | [references/fabrics.md](references/fabrics.md) |
| Declaration schemas, env keys, local ports | [references/values.md](references/values.md) |
| Commands, failure modes, verification | [references/operations.md](references/operations.md) |
| Diagrams and the full doc index | `infra/docs/README.md` |
| Every make target, annotated | `infra/docs/reference/make.md` |
| Modules, inputs, outputs, providers | `infra/docs/reference/terraform.md` |
| The tfctl engine, carrier, sessions, state | the `tfctl` skill |
| Boards, alerts, telemetry pipeline | the `observability` skill |
| Queue and cache contracts behind the ledgers | `services/payment-webhook/specification/messaging.md` · `services/chats/specification/references/cache.md` |
