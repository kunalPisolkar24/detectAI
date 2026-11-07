# Kinds

The engine is one machinery; a **kind** is one stack family. The unit files differ — secrets' `secrets.toml` vs observability's `observability.toml` — but the verbs, the carrier, and the receipts behave the same against either because `app/kinds/__init__.py` defines the single seam: a `Kind` record that names the machinery's callables for one family.

## The declaration file is the registry switch

Which file a stack directory holds decides which kind drives the run:

| Kind | Declaration (committed) | Values (gitignored) | Discovery |
|------|-------------------------|---------------------|-----------|
| **secrets** | `secrets.toml` at the service root — per-service stacks under `services/<name>` ([Declaration](declaration.md)) | `infra/.env` | `--service <name>`, or nearest declaration upward from cwd |
| **observability** | `observability.toml` at the stack root — the New Relic-as-code stack in `observability` | `envs/.env` | `--stack-dir <path>`, or nearest declaration upward |

Both reach for the same two out-of-stack prerequisites — the state bucket and the seeder carrier role ([Carrier](carrier.md)) — created on demand and converged per run, on either plane. What differs is what the stack *is*: secrets turns `infra/.env` into Secrets Manager + SSM; observability terraform-drives the dashboards and alerts root and adds provider-only credentials (New Relic's NRAK triple, never AWS personal keys).

## What a Kind supplies

Every `Kind` is a slot table the engine calls; a kind never edits the engine.

| Slot | What it answers |
|------|-----------------|
| `name`, `declaration_filename`, `values_relpath` | the identity: the file pair and the registry key |
| `stack_root` | the terraform root the kind drives (secrets: the vendored engine stack; observability: `terraform/` under the declaration's directory) |
| `values_hint` | the `fix:` line when the values file is missing |
| `load` | declaration → engine `Declaration` (schema shape-checks live here) |
| `validate` | the values law for verb-wide gating |
| `resolve_plane` | flags in, plane out (`--aws`/`--floci`/file decides) |
| `build_tf_vars` | values → `TF_VAR_*` for the provider block |
| `seeder_policy` | the least-privilege inline policy the carrier role converges to — arbitrary IAM shape; statements carry `Sid`s when they want named scopes |
| `my_verbs`, `carried_verbs` | which verbs run for this kind, and which resolve a carrier session first |
| `terraform_flow`, `verb_flow`, `verify` | the flows: terraform-backed verbs, own verbs, and the live-drift audit (a kind that declares `verify` must supply it) |
| `service_scoped`, `legacy_endpoint_note` | discovery and values-file niceties |

`main.py` is the only engine-side reader of the registry, so wiring stays explicit: each kind exports a `kind()` builder, and `main.py` registers it.

## Introducing a kind

The observability kind is the stack-dir template; a future stack (infra as code, say) follows the same mechanical path:

1. **Declare** — a `declaration.py` loader + a `dataclass(Declaration)` subclass with the kind's schema and `declaration_errors` naming every break.
2. **Values** — a `values.py` law: what the values file must carry, shape-checked, plus `resolve_plane` (flags win; the file breaks ties on its own lines).
3. **Inputs** — a `tfvars.py` mapping values → `TF_VAR_*` for the stack's provider block.
4. **Policy** — a `policy.py` scoping the seeder role to exactly the resources the stack touches (bucket family, provider API surface stays out of AWS — only AWS-visible writes belong here).
5. **Flows** — a `flow.py` per verb family, composed of engine pieces (`ensure_state_bucket`, `build_backend_hcl`, `run_terraform`, the carrier session), or a thin `verb_flow` for verbs that never touch terraform.
6. **Register** — a `kind()` builder returning the `Kind`, and one `register(...)` line + import in `main.py`. The discovery verbs pick the new declaration filename up on their next run.
7. **Tests** — a `tests/unit/test_<kind>.py` for the declaration schema, the values law, and every verb's receipts; integration tests on live Floci may follow the `test_floci_plane.py` sandbox pattern.

Nothing in the engine records which kinds exist — the registry is additive, and no existing kind changes when a third appears.
