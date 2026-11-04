# secretsctl

One generic engine that drives a service's AWS secrets plane: validate its
`infra/.env`, `terraform plan/apply/destroy` its stack, bootstrap the state
bucket, manage the out-of-stack seeder carrier role (MFA session, cached),
verify the live plane against the values, and tear it all down.

Written in place of `services/document-parser/tools/secrets.py` (removed once
the engine matched its suite).

## Plane selection

The plane is a property of the invocation, never of the `.env`:

```sh
secretsctl --service document-parser plan          # floci — the default plane
secretsctl --service document-parser --floci plan  # floci, explicit
secretsctl --service document-parser --aws plan    # real AWS (MFA-gated seeder session)
```

`--floci` and `--aws` are mutually exclusive. The emulator endpoint is the
engine constant `http://localhost:4566`; override it with `SECRETSCTL_FLOCI_URL`
if you ever need to. A legacy `EMULATOR_ENDPOINT` line in a values file is
ignored with a note. Make targets thread the same choice: `make secrets-plan`
runs Floci, `make secrets-plan PLANE=aws` runs real AWS.

## Install and test

```sh
make -C tools/secretsctl install && make -C tools/secretsctl test
poetry run secretsctl --service document-parser plan --dry-run
```

A service opts in with a committed `secrets.toml` at its root — names and
key allowlists only, never secret values; values stay in the gitignored
`infra/.env`. See the design notes in `~/.opencode/plan/secretsctl.md` and
the migration stages in this branch's plan.
