# secretsctl Documentation

Welcome to the secretsctl documentation. This guide covers how the engine takes two files per service — a committed `secrets.toml` and a gitignored `infra/.env` — and turns them into a governed AWS secrets plane.

**The engine in one sentence:** a service-agnostic CLI that validates a service's values, terraform-drives its secrets stack (a JSON blob on Secrets Manager plus config parameters in SSM), verifies the live plane against the values, and tears it all down — with the state bucket and the seeder carrier role created on demand, on either an emulator or real AWS.

## New to secretsctl?

Start here:

1. **[Quick Start](getting-started/quickstart.md)** — install the engine and drive a real service end to end on the emulator
2. **[Architecture](concepts/architecture.md)** — how one invocation becomes a governed AWS change
3. **[Onboarding a service](guides/onboarding-a-service.md)** — the two files that add a service to the plane

## Documentation by Topic

### Concepts

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Architecture](concepts/architecture.md) | Module map, verb dispatch, credential precedence, the output contract | Understanding the system |
| [Declaration](concepts/declaration.md) | The `secrets.toml` schema, slug law, every derived name | Writing or reviewing a declaration |
| [Values](concepts/values.md) | The `.env` roles, the validation ladder, how the plane is chosen | A key refuses to seed, or `.env` edits |
| [Carrier](concepts/carrier.md) | The seeder role: trust ladder, MFA, the cached 12-hour session | IAM prompts, session cache questions |

### Guides

| Guide | What You'll Learn | When to Read |
|-------|-------------------|--------------|
| [The terraform lifecycle](guides/terraform-lifecycle.md) | The verb anatomy, backend composition, state healing, teardown | plan/apply/destroy behavior, or a run surprises you |
| [Verification](guides/verifying.md) | The fingerprint audit, findings vs extras, the drift-heal loop | "is the plane actually right?" |
| [Onboarding a service](guides/onboarding-a-service.md) | The two-file adoption path, step by step | Bringing up a new service |
| [Testing](guides/testing.md) | Unit vs live-Floci integration tiers, the terraform contract tests | Verifying changes |

### Reference

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [CLI reference](reference/cli.md) | Every verb, flag, guard rule, exit code, scriptable receipt | Any command-line work |
| [Make targets](reference/make.md) | The tool-tree's make layer, including the secrets-verb wrappers | Building, linting, testing, or driving the engine |

## The engine at a glance

```mermaid
graph LR
    START(["start: secretsctl …"]) --> INV["invocation<br/>verb + plane + --service"]

    subgraph PIPE["the verb run"]
        INP["declaration<br/>secrets.toml"] --> VALS["values<br/>infra/.env, validated"]
        VALS --> CARRIER["carrier session<br/>converged role, cached 12h"]
        CARRIER --> VERB["terraform / verify / drop flow<br/>(carrier where the verb needs one)"]
    end

    INV --> INP
    VERB --> END(["end: exit code carries the verdict"])

    PIPE -.->|"lengths + fingerprints only"| SAFE["values never print"]
    PIPE -.->|"state bucket + ledger healed<br/>before terraform acts"| STATE["under the carrier session"]
    PIPE -.->|"--floci (default) / --aws"| PLANES["two planes, one stack"]
```

Three conventions ride on top of the diagram: every verb that touches the plane rides the converged seeder role rather than your personal keys, every plane-writing run heals its state ledger before terraform acts, and values appear only as lengths and fingerprints — the printed `ok:`/`error:`/`fix:` receipt plus the exit code is the whole verdict surface.

## Project Structure

```
tools/secretsctl/
├── app/                     the engine
│   ├── main.py              verb dispatch: guards, discovery, wiring
│   ├── declaration/         secrets.toml schema, loader, discovery
│   ├── values/              .env parse, validation, plane resolution
│   ├── carrier/             identity, trust+policy, cached sessions
│   ├── stack/               terraform inputs, state bucket, verb flows
│   ├── verify/              collection, fingerprints, drift findings
│   └── shell.py             aws/terraform subprocess runners
├── terraform/               the one shared stack (module secrets-plane)
├── tests/                   unit (default) + integration (live Floci)
├── mk/                      make fragments
└── docs/                    this documentation
```

## Quick Reference

```bash
make -C tools/secretsctl install && make -C tools/secretsctl test   # ready to drive
poetry -C tools/secretsctl run secretsctl --service document-parser plan --dry-run
poetry -C tools/secretsctl run secretsctl --service document-parser auto-apply   # on floci
poetry -C tools/secretsctl run secretsctl --service document-parser destroy --purge-state --drop-seeder
```

Per-service one-command ergonomics (document-parser's `make secrets-*`) are thin wrappers over this CLI; the [CLI reference](reference/cli.md) is the canonical surface.
