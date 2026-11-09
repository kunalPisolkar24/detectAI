---
name: tfctl
description: DetectAI's tfctl — the stack-agnostic engine in tools/tfctl that drives a stack's AWS + provider plane kind by kind — the per-service secrets stacks (Secrets Manager + SSM from infra/.env) and the New Relic observability stack. Use when running or debugging tfctl verbs, seeding or verifying a service's secrets plane, working with the seeder carrier role, MFA prompts or cached sessions, onboarding a service's secrets.toml, or introducing a new kind.
---

# tfctl — the stack driver

One stack-agnostic engine that drives a stack's AWS + provider plane kind by
kind: validate its values file, terraform plan/apply its stack, tear the
whole thing down. It began as the per-service secrets driver (in place of
`services/document-parser/tools/secrets.py`) and is now a registry of kinds —
the same verbs, carrier, and receipts against every registered stack. Both
out-of-stack prerequisites — the state bucket and the seeder carrier role —
are created on demand and converged every run, on either plane. There is no
bootstrap command: every acting verb heals the ledger it needs.

## Map

```text
tools/tfctl/
├── app/
│   ├── main.py            verb dispatch: flag guards, stack resolution, kind wiring — the composition root
│   ├── engine/            kind-agnostic machinery: carrier, stack state, values, shell runners
│   └── kinds/             the registry — the one seam between engine and stacks
│       ├── secrets/       the secrets kind + the vendored terraform stack it drives
│       └── observability/ the observability kind (stack-dir based, adds check)
├── tests/                 unit (default) + integration (live Floci)
├── mk/ + Makefile         install / lint / test tiers / the secrets-verb wrappers
└── docs/                  the deep documentation tree
```

Two kinds are registered today:

| Kind | Declaration (committed) | Values (gitignored) | Discovery |
|------|-------------------------|---------------------|-----------|
| **secrets** | `secrets.toml` at the service root | `infra/.env` | `--service <name>`, or nearest declaration upward from cwd |
| **observability** | `observability.toml` at the stack root | `envs/.env` | `--stack-dir <path>`, or nearest declaration upward |

A kind never edits the engine — it fills one slot table (`load`, `validate`,
`resolve_plane`, `build_tf_vars`, `seeder_policy`, the flows), and `main.py`
is the only engine-side reader of the registry. The secrets kind's terraform
stack is vendored under `app/kinds/secrets/stack/`; every service shares it,
addressed entirely by service-pinned names.

## Run it

```sh
make -C tools/tfctl install                       # poetry deps; the tfctl command exists in its env
docker start floci                                # the emulator plane on :4566
poetry -C tools/tfctl run tfctl --service document-parser plan --dry-run
poetry -C tools/tfctl run tfctl --service document-parser auto-apply   # plan → apply → verify
poetry -C tools/tfctl run tfctl --service document-parser verify
```

The whole loop is **install → dry-run → auto-apply → verify → destroy** —
all prompt-free on the emulator. Services wrap the same verbs in their own
`make secrets-*` targets (`tools/tfctl/mk/secrets.mk` wraps them with
`SERVICE=` switches). First run, tearing down, and the troubleshooting
table: [references/verbs.md](references/verbs.md)

## The verb surface without breaking it

- Eleven verbs: `plan`, `apply`, `auto-apply`, `verify` (secrets-only),
  `check` (observability-only), `destroy`, `seeder-drop`, `session-clear`,
  `session-refresh`, `session-clear-all`, `session-refresh-all`. Verbs a kind
  does not declare die loudly.
- Flag guards are typed, not advisory: `--purge-state` / `--force-delete` /
  `--drop-seeder` only with `destroy`; `--force` only with
  `session-refresh-all`; the batch verbs refuse `--service` and `--stack-dir`;
  `--service` and `--stack-dir` never together. Every failure prints
  `error:` + a `fix:` line naming exactly what to type next.
- `--dry-run` is a stakeout, not an execution: it resolves no carrier
  session, prompts for nothing, runs no terraform.
- The output contract is scriptable: the `plane:`/`carrier:`/`state:` banner
  opens every run; secret values appear only as
  `KEY *** (N chars, hidden)` and 12-hex fingerprints; exit codes are
  `0` success, `1` any typed failure, `2` argparse, `130` Ctrl+C (terraform
  writes are atomic per run — rerun the same verb).

## Carrier, MFA, sessions — what every run rides

Every plane-writing verb — on **both** planes — rides the stack's
`detectai-<slug>-seeder` role: out-of-stack by design (terraform never
manages its own carrier), least-privilege from the declaration's derived
names — a service never authors IAM.

- On real AWS the assume is **MFA-gated** (trust carries an
  `aws:MultiFactorAuthPresent` condition; root is refused) and the 12-hour
  triplet is cached in `tools/tfctl/.session-cache/<slug>.json` (gitignored,
  0600). A cache hit needs the same role ARN and **more than 10 minutes
  remaining** — a plan → apply stretch prompts for the code **once**.
- The triplet rides as env credentials — they outrank any profile, and
  `AWS_PROFILE` is stripped from subprocesses; nothing is ever written to
  `~/.aws`.
- A stale exported seeder session (`AWS_*` in your shell) is **refused
  loudly**, never bypassed — `session-clear` drops the cache and you unset
  the exports.
- `session-refresh-all` mints every ready service's triplet in one run,
  collecting **one MFA code per device**, typed once and reused across
  services; a failed service reports while the batch moves on. `--force`
  re-mints still-valid caches.
- Before every resolve the role is converged (trust re-anchored to the
  ambient caller, 12-hour cap raised, policy re-attached on drift) — a policy
  change never outlives a cached triplet. Convergence passes silently.
- Teardown steps (`seeder-drop`, trust resolution) run on your ambient
  personal credentials — a role cannot assume itself.

The full trust ladder, cache rules, and verb table:
[references/carrier.md](references/carrier.md)

## Declarations and values — the founding law

| File | Committed? | Holds |
|------|------------|-------|
| `services/<name>/secrets.toml` | yes (reviewed like code) | names, allowlists, length floors — structure only |
| `services/<name>/infra/.env` | **no** | the actual secret values |

The slug is the only identity knob and it pins every AWS name — blob
`detectai/<slug>/secrets`, SSM prefix `/detectai/<slug>/`, role
`detectai-<slug>-seeder`, bucket `detectai-<slug>-tfstate-<account>` — so
it is **forever**: renaming means a new plane, not a rename (and it must fit
S3's 63-char bucket limit, hence the 34-char ceiling). The allowlists are
exhaustive: a `.env` key outside `[secrets]`/`[ssm]` never reaches a plane,
and a key in both is a refused declaration. The schemas, laws, and the
derived-name table: [references/onboarding.md](references/onboarding.md)

## Testing

- `make -C tools/tfctl test` — the unit tier, the default gate before any
  push (no emulator needed).
- `make -C tools/tfctl test-integration` — verb-level behavior against live
  Floci; skips cleanly when the emulator is unreachable.
- `make test-all` both tiers; `make test-cov` fails unit coverage below 65%.
  `make lint` / `make format` are the ruff gates. What each tier proves:
  [references/onboarding.md](references/onboarding.md)

## Guardrails

- Never commit real values — `infra/.env` / `envs/.env` are gitignored; only
  declarations and templates enter git. Secrets print as fingerprints, never
  values — keep it that way in anything you add.
- Never hand-run terraform against a stack: the engine composes the backend
  config (there are no `backend.*.hcl` files), so bare `terraform init` in
  `app/kinds/secrets/stack` is never valid. Drive everything through
  `tfctl` or the make targets.
- No hand-authored IAM — the seeder policy is generated from the declaration;
  widen permissions by changing the kind's `policy.py`, never by editing a
  role by hand.
- The slug is forever; the planes are disjoint; the declaration is the
  exhaustive allowlist.
- A kind never edits the engine — the registry is additive, and introducing
  a kind touches `main.py` only to register it.
- Do not cross service boundaries (monorepo rule): tfctl is the one shared
  tool, and each service's plane is pinned to its own derived names.

## When you need depth

| Need | Go to |
|------|-------|
| First end-to-end run, troubleshooting | `tools/tfctl/docs/getting-started/quickstart.md` |
| Verb dispatch, credential precedence, output contract | `tools/tfctl/docs/concepts/architecture.md` |
| The two kinds and introducing a third | `tools/tfctl/docs/concepts/kinds.md` |
| Declaration schema and derived names | `tools/tfctl/docs/concepts/declaration.md` |
| The values ladder (.env rules) | `tools/tfctl/docs/concepts/values.md` |
| Trust ladder, MFA, cache rules, session verbs | [references/carrier.md](references/carrier.md) |
| Every verb, flag, guard, exit code | [references/verbs.md](references/verbs.md) |
| Onboarding a service or a kind | [references/onboarding.md](references/onboarding.md) |
| The terraform verbs under the hood | `tools/tfctl/docs/guides/terraform-lifecycle.md` |
| What verify proves, row by row | `tools/tfctl/docs/guides/verifying.md` |
| Test tiers | `tools/tfctl/docs/guides/testing.md` |
| The service-side view of the secrets plane | the `payment-webhook` skill · the `document-parser` skill |
| The observability stack this engine drives | the `observability` skill |
