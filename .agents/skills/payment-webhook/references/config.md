# The config planes — Secrets Manager, SSM, and the tfctl carrier

The service keeps secrets deliberately small: **one credential guards every
webhook** — `PADDLE_WEBHOOK_SECRET` — plus the observability license key when
telemetry is on. This page covers where each value lives per plane, how the
plane is provisioned and verified, and the carrier machinery (MFA, sessions)
every verb rides. The engine behind it all is [`tools/tfctl`](../../../../tools/tfctl/docs/README.md)
— its mechanics are the `tfctl` skill's subject; here is what a service
operator actually touches.

## Where each value lives

| Value | Dev plane | Prod plane | Load/e2e rig |
|-------|-----------|------------|--------------|
| `PADDLE_WEBHOOK_SECRET` | process env, or `infra/.env` (env wins) | Secrets Manager blob (`detectai/payment-webhook/secrets`) | `infra/.env.load` (must match the service's value) |
| `NEW_RELIC_LICENSE_KEY` | process env, or `infra/.env` | Secrets Manager blob — same JSON object | not needed |

Files that hold real values (`infra/.env`, `infra/.env.load`) are gitignored;
only their committed templates (`.env.example`, `.env.load.example`) ever
enter the repository. The plane's *shape* — which keys are secret, which are
plain config, the length floors — is the committed `secrets.toml` at the
service root; the values stay out of git entirely.

## Two AWS sources, disjoint by contract

- **Secrets Manager** — one JSON blob, `detectai/payment-webhook/secrets`,
  whose keys are env names; the prod boot fetches it whole, once.
- **SSM parameters** — plain, non-secret settings under
  `/detectai/payment-webhook/`, from the `[ssm]` allowlist in `secrets.toml`
  (`PORT`, `DRAIN_TIMEOUT`, `MAX_BODY_BYTES`, `QUEUE_URL`, `PUBLISH_BUDGET`).

A key seeded into **both** sources fails the boot loudly — the planes are
disjoint by seeding contract, and the declaration refuses a key listed twice.
A `.env` line outside the allowlists never reaches the plane: nothing is
seeded implicitly.

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

The one-shot verb is `make secrets-auto-apply` — validate, plan, apply,
verify in a single run, stopping at the first failure. Onboarding a plane or
seeding a values change end-to-end is exactly that. `make secrets-test` runs
the tfctl engine suite.

Supporting verbs: `secrets-verify` reports **fingerprints and lengths only**
(first 12 hex of a SHA-256 per value) and exits 1 on drift; the teardown and
session verbs are in the tables below. The state bucket and the seeder role
are created on demand — nothing to bootstrap first.

## The carrier: MFA, sessions, and what bites

Every plane-writing verb — on **both** planes — rides
`detectai-payment-webhook-seeder`, a least-privilege IAM role the engine
converges on demand (a service never authors IAM). The rules an operator
needs:

- **12-hour sessions, cached.** On real AWS the assume asks for your MFA code
  and the resulting triplet is cached gitignored in
  `tools/tfctl/.session-cache/payment-webhook.json` (0600). A cache hit needs
  the same role ARN and **more than 10 minutes remaining** — so a
  `secrets-plan` → `secrets-apply` stretch prompts for the code **once**.
  Nothing is ever written to `~/.aws`; the triplet rides as env credentials
  and outranks any profile.
- **Stale exports are refused, not bypassed.** If your ambient identity
  already *is* a seeder session (leftover exported `AWS_*` variables), the
  verb dies with the fix spelled out: unset them, then
  `make secrets-session-clear` drops the cached file.
- **The session verbs:**

  | Verb | Acts on | What it does |
  |------|---------|--------------|
  | `make secrets-session-clear` | this service | delete the cached triplet; the next verb assumes again |
  | `make secrets-session-clear-all` | every service | delete all cached triplets |
  | `make secrets-session-refresh-all` | every ready service | mint fresh triplets in one run — **one MFA code per device**, typed once and reused; `FORCE=1` re-mints even valid ones, `DRY_RUN=1` just lists |

  A failed assume earns one re-prompt (the device's window rolled over), then
  the service reports failed while the batch moves on.
- **Teardown of the role itself runs on your personal credentials** — a role
  cannot assume itself — as does the trust resolution. An assumed-role caller
  cannot derive an MFA device: ride your IAM user credentials instead.

## Teardown verbs

| Verb | Removes | Keeps |
|------|---------|-------|
| `make secrets-clean` | the secret + versions, the SSM parameters (terraform destroy) | state bucket, ledger, seeder role |
| `make secrets-destroy` | everything above, plus every object version, the state bucket (`--purge-state`), and the seeder role (`--drop-seeder`) | nothing |
| `make secrets-drop-seeder` | the seeder policy and role only (personal creds) | state bucket, ledger, stack resources |

Teardown runs unattended: destroy auto-approves on both planes, and the purge
previews what it will wipe — warning when the bucket holds objects outside
`payment-webhook/`. Destroy schedules the secret into its recovery window
(30 days on real AWS; the emulator always uses 0). Skipping an existing
window needs `FORCE_DELETE=1` on a destroy-call target.

## Rotation

1. Update the value in the plane it lives in (`make secrets-apply` for prod;
   edit the file for dev).
2. Restart the service. Config is resolved **once** per boot, so a rotated
   key goes live exactly when a new instance starts — never mid-flight.

For a real rotation, Paddle's dashboard and this secret must change together:
the dashboard pairs its destination with one signing secret at a time.

## Gotchas

- The state ledger is derived per (service, account) with separate keys per
  plane — a change of region or account points terraform at a different,
  empty ledger; `plan` offers to recreate everything, and nothing migrates.
- The emulator's S3 and Secrets data is in-memory: a container restart can
  drop it. Any terraform verb recreates the bucket, so a bare
  `make secrets-apply` rebuilds the plane.
- Real AWS needs Terraform ≥ 1.10 for the `use_lockfile` backend flag.
- The state file stores `secret_string` in plaintext — keep the prod bucket
  versioned, encrypted, and access-restricted.
- The emulator accepts every IAM call but never enforces IAM policies — a
  green apply there proves structure only; enforcement bites on real AWS.

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

The engine behind every verb above — kinds, declaration schema, the terraform
lifecycle — is the `tfctl` skill; this service's runtime view of the
credential is `docs/guides/secrets.md`.
