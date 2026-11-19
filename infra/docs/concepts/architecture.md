# Architecture

This document explains how one `make plan` becomes a governed change on a plane. Read the [Quick Start](../getting-started/quickstart.md) first if nothing has run yet.

## What this stack is

A declared set of shared fabrics, not a service. `infra.toml` says which fabrics exist, `envs/.env` supplies their plane-specific values, and tfctl's `infra` kind drives one Terraform root that plans each declared fabric. The root is stateless between runs: state lives in an S3 bucket created on demand, and every acting verb rides a converged seeder role. The driver's internals belong to [tfctl's documentation](../../../tools/tfctl/docs/README.md); this page covers the infra side of that seam.

## The component map

```mermaid
graph TB
    subgraph DECL["infra.toml — the ledger"]
        Q["[[queues]]"]
        C["[[elasticache]]"]
        A["[[atlas]]"]
    end

    subgraph ROOT["terraform root — main.tf"]
        MQ["module queues<br/>count = queues > 0"]
        MC["module elasticache<br/>count = caches > 0"]
        MA["module atlas<br/>count = clusters > 0"]
    end

    subgraph AWS["AWS plane — provider aws"]
        SQS["aws_sqs_queue<br/>.terminal + .redrive_source"]
        Redis["subnet group +<br/>replication group"]
    end

    subgraph PUBLIC["public API — mongodbatlas.fabric"]
        Atlas["advanced_cluster +<br/>database_user + access_list"]
    end

    Q --> MQ --> SQS
    C --> MC --> Redis
    A --> MA --> Atlas
    MQ -.->|"one module for the whole ledger"| SQS
    MA -.->|"no emulator: real API on both planes"| Atlas
```

Each ledger maps to exactly one module. The `count` gate means an empty ledger plans no module at all — there is no "empty resource" fallback.

## What tfctl contributes

| Step | What happens |
|------|--------------|
| Load | Read `infra.toml` and `envs/.env`; reject unknown sections, bad names, missing values |
| Plane | `--floci` or `--aws`; on Floci, probe `/_localstack/health` within 2 seconds |
| Carrier | Resolve the plane account, converge the `detectai-infra-seeder` role, assume a session |
| State | Head the derived `detectai-infra-tfstate-<account>` bucket; create and version it if missing |
| Backend | Compose the plane's backend file, run `init -reconfigure` with it, then delete the temp file |
| Verb | Run Terraform with the `TF_VAR_*` overlay and the carrier credentials; destroy may purge state and drop the role |

There is no bootstrap command: the first run that needs the bucket or the role creates it.

## One `make plan`, end to end

```mermaid
sequenceDiagram
    autonumber
    participant U as you
    participant M as make (infra)
    participant T as tfctl infra kind
    participant A as aws CLI
    participant S as state bucket
    participant TF as terraform

    U->>M: make plan
    M->>T: tfctl --stack-dir infra --floci plan
    T->>T: load infra.toml, parse envs/.env, validate declared fabrics
    T->>T: probe emulator health (Floci only, 2s)
    T->>A: resolve plane account, converge seeder role, assume session
    A-->>T: carrier session
    T->>S: head bucket, create and version if missing
    T->>TF: init -reconfigure with the temp backend file
    TF-->>T: plan: queues=2, elasticache=1, atlas=1
    T-->>U: exit 0 + the plan
    note over T,S: the bucket and role are created on demand - no bootstrap step
    note over TF: Atlas is planned on both planes - its API is public
```

Apply adds the approval rule: auto on Floci, interactive on real AWS. Destroy auto-approves on both, then optionally purges state and drops the seeder role.

## From declaration to resources

```mermaid
graph TB
    START(["start: infra.toml loaded"]) --> Q{"[[queues]] entries?"}
    Q -->|"yes"| MQ["module queues<br/>count = 1"]
    Q -->|"no"| C{"[[elasticache]] entries?"}
    MQ --> C
    C -->|"yes"| MC["module elasticache<br/>count = 1"]
    C -->|"no"| A{"[[atlas]] entries?"}
    MC --> A
    A -->|"yes"| MA["module atlas<br/>count = 1"]
    A -->|"no"| NONE["no modules planned"]
    MA --> END(["end: terraform plan"])
    NONE --> END
```

## The two planes

| | Floci (default) | Real AWS |
|---|---|---|
| State | S3 on the emulator | S3 in the caller's account |
| AWS endpoints | `http://localhost:4566` with test credentials | Region defaults |
| Seeder role | Emulated account | Assumed with MFA, cached 12 hours |
| Atlas | Real MongoDB Cloud, state tracked on Floci | Real MongoDB Cloud |
| Apply | Auto-approved | Interactive confirmation |

Services stay endpoint-agnostic: `QUEUE_URL` / `AWS_ENDPOINT_URL_SQS`, `REDIS_ENDPOINT` / `REDIS_AUTH_TOKEN`, and `MONGO_URI` / `MONGO_DATABASE` decide which twin they talk to — the [Docker twins](docker-twins.md) locally, these fabrics on a plane.

## Next Steps

- **[Fabrics](fabrics.md)** — what each module creates and the contracts it emits
- **[Configuration](../getting-started/configuration.md)** — the two input files in full
- **[Terraform Layout](../reference/terraform.md)** — variables, outputs, providers
