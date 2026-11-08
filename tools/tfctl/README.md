# tfctl

One stack-agnostic engine that drives a stack's AWS + provider plane kind by kind: validate its values file, terraform plan/apply its stack, and tear the whole thing down. The state bucket and the out-of-stack seeder carrier role (the assumed session every verb rides, cached for 12 hours) are created on demand and converged on both planes — the Floci emulator (the default) and real AWS. It began as the per-service secrets stack driver (in place of `services/document-parser/tools/secrets.py`) and is now a registry of kinds.

Full documentation lives in [`docs/`](docs/README.md): the [quick start](docs/getting-started/quickstart.md), the [concept pages](docs/concepts/architecture.md), the [guides](docs/guides/terraform-lifecycle.md), and the [CLI reference](docs/reference/cli.md).

## How a stack takes part

Two kinds are registered today:

- **secrets** — a service opts in with a committed `secrets.toml` at its root; values stay in the gitignored `infra/.env`. The engine finds the declaration walking upward from the current directory, or from an explicit `--service <name>`. Every AWS name derives from its `slug`: the blob `detectai/<slug>/secrets`, the SSM prefix `/detectai/<slug>/`, the role `detectai-<slug>-seeder`, the state bucket `detectai-<slug>-tfstate-<account>`.
- **observability** — the New Relic-as-code root opts in with `observability.toml`; values stay in its gitignored `envs/.env`. It is stack-dir based: drive it from its directory or with `--stack-dir observability`. Adds the `check` verb (a live credential + account round-trip); the state bucket needs no setup — plan/apply create it on demand.

The fastest way to onboard a service is the [onboarding guide](docs/guides/onboarding-a-service.md); the registry seam and how to introduce a kind is [Kinds](docs/concepts/kinds.md).

## Install and test

```sh
make -C tools/tfctl install && make -C tools/tfctl test
poetry -C tools/tfctl run tfctl --service document-parser plan --dry-run
```

The full command surface is the [CLI reference](docs/reference/cli.md): eleven verbs (`plan`, `apply`, `auto-apply`, `verify`, `check`, `destroy`, `seeder-drop`, `session-clear`, `session-refresh`, `session-clear-all`, `session-refresh-all` — `verify` is secrets-only), plane flags (`--floci` default / `--aws` MFA-gated), and typed-guarded extras (`--dry-run`, `--purge-state`, `--force-delete`, `--drop-seeder` on destroy; `--force` on `session-refresh-all`). Secret values never print — keys appear as lengths and fingerprints only.

## Documentation

| Tier | Start with |
|------|------------|
| Getting started | [Quick Start](docs/getting-started/quickstart.md) |
| Concepts | [Architecture](docs/concepts/architecture.md) · [Kinds](docs/concepts/kinds.md) · [Declaration](docs/concepts/declaration.md) · [Values](docs/concepts/values.md) · [Carrier](docs/concepts/carrier.md) |
| Guides | [The terraform lifecycle](docs/guides/terraform-lifecycle.md) · [Verification](docs/guides/verifying.md) · [Onboarding a service](docs/guides/onboarding-a-service.md) · [Testing](docs/guides/testing.md) |
| Reference | [CLI](docs/reference/cli.md) · [Make targets](docs/reference/make.md) |
