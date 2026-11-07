# tfctl

One generic engine that drives a service's AWS secrets plane: validate its `infra/.env`, terraform plan/apply/destroy its stack, verify the live plane against the values, and tear it all down. The state bucket and the out-of-stack seeder carrier role (the assumed session every verb rides, cached for 12 hours) are created on demand and converged on both planes — the Floci emulator (the default) and real AWS. Written in place of `services/document-parser/tools/secrets.py` (removed once the engine matched its suite).

Full documentation lives in [`docs/`](docs/README.md): the [quick start](docs/getting-started/quickstart.md), the [concept pages](docs/concepts/architecture.md), the [guides](docs/guides/terraform-lifecycle.md), and the [CLI reference](docs/reference/cli.md).

## How a service takes part

A service opts in with a committed `secrets.toml` at its root — names and key allowlists only, never secret values; values stay in the gitignored `infra/.env`. The engine finds the declaration walking upward from the current directory, or from an explicit `--service <name>`. Every AWS name derives from its `slug`: the blob `detectai/<slug>/secrets`, the SSM prefix `/detectai/<slug>/`, the role `detectai-<slug>-seeder`, the state bucket `detectai-<slug>-tfstate-<account>`.

The fastest way to onboard a service is the [onboarding guide](docs/guides/onboarding-a-service.md).

## Install and test

```sh
make -C tools/tfctl install && make -C tools/tfctl test
poetry -C tools/tfctl run tfctl --service document-parser plan --dry-run
```

The full command surface is the [CLI reference](docs/reference/cli.md): nine verbs (`plan`, `apply`, `auto-apply`, `verify`, `destroy`, `seeder-drop`, `session-clear`, `session-clear-all`, `session-refresh-all`), plane flags (`--floci` default / `--aws` MFA-gated), and typed-guarded extras (`--dry-run`, `--purge-state`, `--force-delete`, `--drop-seeder` on destroy; `--force` on `session-refresh-all`). Secret values never print — keys appear as lengths and fingerprints only.

## Documentation

| Tier | Start with |
|------|------------|
| Getting started | [Quick Start](docs/getting-started/quickstart.md) |
| Concepts | [Architecture](docs/concepts/architecture.md) · [Declaration](docs/concepts/declaration.md) · [Values](docs/concepts/values.md) · [Carrier](docs/concepts/carrier.md) |
| Guides | [The terraform lifecycle](docs/guides/terraform-lifecycle.md) · [Verification](docs/guides/verifying.md) · [Onboarding a service](docs/guides/onboarding-a-service.md) · [Testing](docs/guides/testing.md) |
| Reference | [CLI](docs/reference/cli.md) · [Make targets](docs/reference/make.md) |
