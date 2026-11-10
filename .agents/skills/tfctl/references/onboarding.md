# Onboarding — a service, and a kind

Two adoption paths, in increasing depth: give a service a secrets plane
(two files), or teach the engine a new stack family (a kind).

## Onboarding a service

A service joins the secrets plane by contributing **two files**: a committed
`secrets.toml` (shape) and a gitignored `infra/.env` (values). Nothing else
is copied, forked, or registered anywhere — no make file, no CI job, no IAM
to write. The engine reads the pair and drives the plane.

### Step 1: declare the shape

Create `services/<name>/secrets.toml`. Ask two questions per runtime key:

- **Is it secret?** → `[secrets] keys`. It becomes part of the one JSON blob
  at `detectai/<name>/secrets`.
- **Is it plain config the service reads?** → `[ssm] keys`. It becomes
  `/detectai/<name>/<KEY>`.

```toml
[service]
slug = "<name>"              # lowercase-digits-hyphens, ≤ 34 chars: the name drives everything

[secrets]
keys = ["API_KEY"]           # every env name that must stay secret

[secrets.min_lengths]
API_KEY = 16                 # the boot gate, mirrored so the plane refuses what the service would

# [ssm]                      # optional: non-secret config you want on the plane
# keys = ["UPLOAD_LIMIT_BYTES"]
```

Optional extras: `region` and `recovery_window` (0 or 7–30 days) under
`[service]`; `[requires]` pairing gates (if trigger key `X` is set in
`.env`, blob key `Y` must also be set with at least `floor` chars).

Three laws bite early — onboarding is where they all usually trip:

- **The slug is forever.** Every AWS name derives from it; renaming later
  means a new plane, not a rename. The 34-char ceiling is not stylistic: the
  derived state bucket carries a 29-character scaffold and must fit S3's
  63-char limit.
- **The allowlist is exhaustive.** A `.env` line outside these lists never
  reaches the plane; plan's `--dry-run` banner tells you what *will* ride.
- **The planes are disjoint.** The same key in `[secrets]` and `[ssm]` is a
  refused declaration, not a warning.

### Step 2: provide the values

```sh
cd services/<name>
cp infra/.env.example infra/.env    # then edit: real values, no placeholders
```

The engine's validation ladder checks the blob keys against your
`min_lengths` floors and a handful of consistency rules — expect the first
`plan` to tell you each rule by name.

### Step 3: read the dry run

```sh
poetry -C tools/tfctl run tfctl --service <name> plan --dry-run
```

The banner previews everything the real run would do: plane, keys with
lengths, the exact bucket and state key, the composed backend. Skipping real
execution until this page reads true is the cheapest mistake insurance in
the whole flow.

### Step 4: build the plane

```sh
docker start floci                                                   # or your Floci container's name
poetry -C tools/tfctl run tfctl --service <name> auto-apply
```

`auto-apply` is onboarding's one-button verb: validate, plan, apply
(auto-approved on the emulator), then verify the live plane against your
`.env`. A first run shows two self-heals on the way in — the seeder role
created and converged, the state bucket healed into existence — both normal
on a brand-new plane.

### Step 5: real AWS later, not first

Everything above is identical on real AWS except the gate flag — `--aws` —
and its two consequences: an MFA prompt per 12-hour carrier window, and an
interactive confirmation on `apply`. Leave production-shaped runs until the
emulator flow is boring, and make your first real verb `plan`.

### What "onboarded" means afterwards

| You can now | With |
|-------------|------|
| Seed a values change to the plane | edit `.env` → `plan` → `apply` → `verify` |
| Wipe the plane and start over | `destroy` (or `destroy --purge-state --drop-seeder` for the full teardown) |
| Clear a stale 12-hour session | `session-clear` |
| Refresh every service's sessions in one run | `session-refresh-all` |

## Introducing a kind

The observability kind is the stack-dir template; a future stack (infra as
code, say) follows the same mechanical path:

1. **Declare** — a `declaration.py` loader + a `dataclass(Declaration)`
   subclass with the kind's schema and `declaration_errors` naming every
   break.
2. **Values** — a `values.py` law: what the values file must carry,
   shape-checked, plus `resolve_plane` (flags win; the file breaks ties on
   its own lines).
3. **Inputs** — a `tfvars.py` mapping values → `TF_VAR_*` for the stack's
   provider block.
4. **Policy** — a `policy.py` scoping the seeder role to exactly the
   resources the stack touches (bucket family; the provider's API surface
   stays out of AWS — only AWS-visible writes belong here).
5. **Flows** — a `flow.py` per verb family, composed of engine pieces
   (`ensure_state_bucket`, `build_backend_hcl`, `run_terraform`, the carrier
   session), or a thin `verb_flow` for verbs that never touch terraform.
6. **Register** — a `kind()` builder returning the `Kind`, and one
   `register(...)` line + import in `main.py`. The discovery verbs pick the
   new declaration filename up on their next run.
7. **Tests** — a `tests/unit/test_<kind>.py` for the declaration schema, the
   values law, and every verb's receipts; integration tests on live Floci
   may follow the `test_floci_plane.py` sandbox pattern.

Nothing in the engine records which kinds exist — the registry is additive,
and no existing kind changes when a third appears.

## The test tiers

| Target | What it runs | When |
|--------|--------------|------|
| `make -C tools/tfctl test` | unit tier: `pytest -m "not integration"` | the default gate before any push |
| `make test-integration` | `pytest -m integration` against live Floci (skips cleanly when unreachable) | verb-level behavior changed |
| `make test-all` | both tiers in one go | before an onboarding-shaped change |
| `make test-cov` | unit tier with a coverage report, failing below 65% | when coverage is the point |
| `make secrets-test` (from a service) | the same engine suite | the engine changed while working in a service |

`make lint` (`ruff check .`) and `make format --check` are the style gates —
the same repo-wide Python standard.
