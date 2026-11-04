# secretsctl

One generic engine that drives a service's AWS secrets plane: validate its
`infra/.env`, `terraform plan/apply/destroy` its stack, bootstrap the state
bucket, manage the out-of-stack seeder carrier role (MFA session, cached),
verify the live plane against the values, and tear it all down.

Written in place of `services/document-parser/tools/secrets.py`; built
side-by-side with it during migration (nothing switches over until the engine
matches its suite).

```sh
make -C tools/secretsctl install && make -C tools/secretsctl test
poetry run secretsctl --service document-parser plan --dry-run
```

A service opts in with a committed `secrets.toml` at its root — names and
key allowlists only, never secret values; values stay in the gitignored
`infra/.env`. See the design notes in `~/.opencode/plan/secretsctl.md` and
the migration stages in this branch's plan.
