# The secrets stack

The service keeps secrets deliberately small: **one credential guards every
webhook** — `PADDLE_WEBHOOK_SECRET` — plus the observability license key when
telemetry is on. The prod plane is seeded as Terraform, driven entirely by
`tools/tfctl` through the make targets; there is no hand-rolled terraform and
no other write path.

## Where each value lives

| Value | Dev plane | Prod plane | Load/e2e rig |
|-------|-----------|------------|--------------|
| `PADDLE_WEBHOOK_SECRET` | process env, or `infra/.env` (env wins) | Secrets Manager blob (`detectai/payment-webhook/secrets`) | `infra/.env.load` (must match the service's value) |
| `NEW_RELIC_LICENSE_KEY` | process env, or `infra/.env` | Secrets Manager blob — same JSON object | not needed |

Files that hold real values (`infra/.env`, `infra/.env.load`) are gitignored;
only their committed templates (`.env.example`, `.env.load.example`) ever
enter the repository.

## The plane model

- **Secrets Manager** — one JSON blob whose keys are the env names; the prod
  boot resolves the *whole* blob in one fetch.
- **SSM parameters** — plain settings under `/detectai/payment-webhook/`,
  paged in one `GetParametersByPath` walk.
- The two AWS sources are **disjoint by seeding contract**: a key found in
  both fails the boot loudly — an operator error is never papered over.
- Process env and dotenv never reach the prod path, so a stray variable
  cannot leak a value in. `AWS_REGION` and the `AWS_ENDPOINT_URL_*` overrides
  are bootstrap variables, not config.

## The verbs

Run from `services/payment-webhook`; every verb takes `PLANE=floci|aws`
(default floci; auto-approved on the emulator plane, interactive confirm on
real AWS) and `DRY_RUN=1` previews any verb:

```sh
make secrets-check        # validate infra/.env, preview the plane — no terraform, no AWS
make secrets-plan         # terraform plan against the selected plane
make secrets-apply        # apply — auto on floci, interactive on real AWS
make secrets-verify       # read the live plane and match it against infra/.env
```

Supporting verbs: `secrets-auto-apply` (validate + plan + apply + verify,
stopping at the first failure), `secrets-drop-seeder` (detach the seeder
policy and delete the role), `secrets-clean` (destroy, keeping the state
bucket and ledger), `secrets-destroy` (full teardown, state bucket purged),
and the `secrets-session-*` pair for cached seeder sessions (~12 h per
service, MFA-gated on real AWS; `secrets-session-refresh-all` mints fresh
sessions across ready services, `FORCE=1` applies). `make secrets-test` runs
the tfctl engine suite.

The state bucket and the seeder carrier role are created on demand — nothing
to set up first. `secrets-verify` reports fingerprints and lengths only, and
exits 1 on drift.

## Rotation

1. Update the value in the plane it lives in (`make secrets-apply` for prod;
   edit the file for dev).
2. Restart the service. Config is resolved **once** per boot, so a rotated
   key goes live exactly when a new instance starts — never mid-flight.

For a real rotation, Paddle's dashboard and this secret must change together:
the dashboard pairs its destination with one signing secret at a time.

## Hygiene checklist

- [ ] Real values only in gitignored files — never in templates, no matter
      how harmless they look.
- [ ] `PADDLE_WEBHOOK_SECRET` is ≥ 16 characters (the boot enforces it; make
      it long anyway).
- [ ] Nothing echoes the credential into logs — the service never does; keep
      your own tooling equally quiet.
- [ ] Do not add a second webhook credential ("the same key in an `x-api-key`
      header too") — one secret, one header.
- [ ] Rotate with only the documented apply + restart flow, so every
      component reads the same version.
