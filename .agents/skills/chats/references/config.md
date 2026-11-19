# The config planes — Secrets Manager, SSM, and the tfctl carrier

The service keeps four credentials and ten plain settings. This page covers where each lives per plane, how the plane is provisioned and verified, and the carrier machinery (MFA, sessions) every verb rides. The engine behind it all is [`tools/tfctl`](../../../../tools/tfctl/docs/README.md) — its mechanics are the `tfctl` skill's subject; here is what a service operator actually touches.

## Where each value lives

| Value | Dev plane | Prod plane | Load/e2e rig |
|-------|-----------|------------|--------------|
| `API_KEY` | process env, or `infra/.env` (env wins) | Secrets Manager blob (`detectai/chats/secrets`) | `infra/.env.load` (must match the service's value) |
| `MONGO_URI` | process env, or `infra/.env` | Secrets Manager blob — same JSON object | `infra/.env.load` |
| `REDIS_AUTH_TOKEN` | process env, or `infra/.env` | Secrets Manager blob — same JSON object | `infra/.env.load` |
| `NEW_RELIC_LICENSE_KEY` | process env, or `infra/.env` | Secrets Manager blob — same JSON object | not needed unless telemetry is wired |

Plain settings — `PORT`, `DRAIN_TIMEOUT`, `MONGO_DATABASE`, `REDIS_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_VERSION`, `OTEL_TRACE_SAMPLE_RATIO`, `RATE_LIMIT_CREATE_MAX`, `RATE_LIMIT_WRITE_MAX` — come from process env over `infra/.env` in dev, and from the SSM tree in prod.

Files that hold real values (`infra/.env`, `infra/.env.load`) are gitignored; only their committed templates ever enter the repository. The plane's *shape* — which keys are secret, which are plain config, the length floors — is the committed `secrets.toml` at the service root. Setting `OTEL_EXPORTER_OTLP_ENDPOINT` additionally requires `NEW_RELIC_LICENSE_KEY` (≥ 16 chars); that dependency is declared under `[requires]`.

## Two AWS sources, disjoint by contract

- **Secrets Manager** — one JSON blob, `detectai/chats/secrets`, whose keys are env names; the prod boot fetches it whole, once.
- **SSM parameters** — plain settings under `/detectai/chats/`, from the `[ssm]` allowlist in `secrets.toml`. `SecureString` parameters are refused.

A key seeded into **both** sources fails the boot loudly — the planes are disjoint by seeding contract, and the declaration refuses a key listed twice. A `.env` line outside the allowlists never reaches the plane: nothing is seeded implicitly.

## Fail-fast vs fail-closed

The split that matters at boot:

- **Fails the boot:** a missing or short credential, a malformed `MONGO_URI` / `REDIS_ENDPOINT`, a `PORT` outside 1–65535, a rate-limit max that is non-positive or non-integer, a sample ratio outside `(0, 1]`, and a set OTel endpoint without a ≥ 16-char license key.
- **Fails closed:** an unreadable `DRAIN_TIMEOUT`, database name, service name/version, or a missing rate-limit max — the safe default wins and the boot continues.
- **Degrades, never fails:** an unreachable Redis. `cache.Setup` installs `NullCache` + `NullLimiter` with a warning; Mongo and the RPCs are unaffected.

Changing any value means a restart — config is resolved once per boot.

## The verbs

Run from `services/chats`; every verb takes `PLANE=floci|aws` (default floci; auto-approved on the emulator plane, interactive confirm on real AWS) and `DRY_RUN=1` previews any verb:

```sh
make secrets-check        # validate infra/.env, preview the plane — no terraform, no AWS
make secrets-plan         # terraform plan against the selected plane
make secrets-apply        # apply — auto on floci, interactive on real AWS
make secrets-verify       # read the live plane and match it against infra/.env
```

The one-shot verb is `make secrets-auto-apply` — validate, plan, apply, verify in a single run, stopping at the first failure. Onboarding a plane or seeding a values change end-to-end is exactly that. `make secrets-test` runs the tfctl engine suite.

`secrets-verify` reports **fingerprints and lengths only** (a 12-hex SHA-256 prefix per value) and exits 1 on drift. The state bucket and the seeder role are created on demand — nothing to bootstrap first.

## The carrier: MFA, sessions, and what bites

Every plane-writing verb — on **both** planes — rides `detectai-chats-seeder`, a least-privilege IAM role the engine converges on demand (a service never authors IAM). The rules an operator needs:

- **12-hour sessions, cached.** On real AWS the assume asks for your MFA code and the resulting triplet is cached gitignored in `tools/tfctl/.session-cache/chats.json` (0600). A cache hit needs the same role ARN and **more than 10 minutes remaining** — so a `secrets-plan` → `secrets-apply` stretch prompts for the code **once**. Nothing is ever written to `~/.aws`; the triplet rides as env credentials and outranks any profile.
- **Stale exports are refused, not bypassed.** If your ambient identity already *is* a seeder session (leftover exported `AWS_*` variables), the verb dies with the fix spelled out: unset them, then `make secrets-session-clear` drops the cached file.
- **The session verbs:**

  | Verb | Acts on | What it does |
  |------|---------|--------------|
  | `make secrets-session-clear` | this service | delete the cached triplet; the next verb assumes again |
  | `make secrets-session-clear-all` | every service | delete all cached triplets |
  | `make secrets-session-refresh-all` | every ready service | mint fresh triplets in one run — **one MFA code per device**, typed once and reused; `FORCE=1` re-mints even valid ones, `DRY_RUN=1` just lists |

  A failed assume earns one re-prompt (the device's window rolled over), then the service reports failed while the batch moves on.
- **Teardown of the role itself runs on your personal credentials** — a role cannot assume itself — as does the trust resolution. An assumed-role caller cannot derive an MFA device: ride your IAM user credentials instead.

## Teardown verbs

| Verb | Removes | Keeps |
|------|---------|-------|
| `make secrets-clean` | the secret + versions, the SSM parameters (terraform destroy) | state bucket, ledger, seeder role |
| `make secrets-destroy` | everything above, plus every object version, the state bucket (`--purge-state`), and the seeder role (`--drop-seeder`) | nothing |
| `make secrets-drop-seeder` | the seeder policy and role only (personal creds) | state bucket, ledger, stack resources |

Teardown runs unattended: destroy auto-approves on both planes, and the purge previews what it will wipe — warning when the bucket holds objects outside `chats/`. Destroy schedules the secret into its recovery window (30 days on real AWS; the emulator always uses 0). Skipping an existing window needs `FORCE_DELETE=1` on a destroy call.

## Rotation

1. Update the value in the plane it lives in (`make secrets-apply` for prod; edit the file for dev).
2. Restart the service. Config is resolved **once** per boot, so a rotated key goes live exactly when a new instance starts — never mid-flight.

## Gotchas

- The state ledger is derived per (service, account) with separate keys per plane — a change of region or account points terraform at a different, empty ledger; `plan` offers to recreate everything, and nothing migrates.
- The emulator's S3 and Secrets data is in-memory: a container restart can drop it. Any terraform verb recreates the bucket, so a bare `make secrets-apply` rebuilds the plane.
- Real AWS needs Terraform ≥ 1.10 for the `use_lockfile` backend flag.
- The state file stores `secret_string` in plaintext — keep the prod bucket versioned, encrypted, and access-restricted.
- The emulator accepts every IAM call but never enforces IAM policies — a green apply there proves structure only; enforcement bites on real AWS.

## Hygiene checklist

- [ ] Real values only in gitignored files — never in templates, no matter how harmless they look.
- [ ] `API_KEY` ≥ 16 chars, and `MONGO_URI` / `REDIS_ENDPOINT` well-formed (the boot enforces all three).
- [ ] `REDIS_AUTH_TOKEN` ≥ 16 chars whenever `REDIS_ENDPOINT` is `rediss://`.
- [ ] Nothing echoes a credential into logs — the service never does; keep your own tooling equally quiet.
- [ ] Do not add a second credential carrier — one api key, plus the asserted user header it authenticates.
- [ ] Rotate with only the documented apply + restart flow, so every component reads the same version.

The engine behind every verb above — kinds, declaration schema, the terraform lifecycle — is the `tfctl` skill; this service's runtime view of the credential is `docs/guides/secrets.md`.

[Back to the briefing](../SKILL.md)
