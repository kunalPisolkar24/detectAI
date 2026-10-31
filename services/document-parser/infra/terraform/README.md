# document-parser — Terraform (App-Side AWS)

Provisions this service's app-side AWS slice as two resources, both pinned to
the `detectai/document-parser/` naming. The stack **does not deploy the app** —
the app runs locally or via `infra/compose.yml`; this stack manages only what
the app reads at boot, and creates **no IAM identity**:

1. **Secrets blob** — `detectai/document-parser/secrets`, a JSON object seeded
   from `infra/.env` (`API_KEY` and friends), fetched whole by the prod config plane
2. **Config parameters** — non-secret runtime config as SSM parameters under
   `/detectai/document-parser/<KEY>`, seeded from the allowlist in
   `tools/secrets.py` (`SSM_SEED_KEYS`)

## Layout

- Root stack: `main.tf`, `providers.tf`, `variables.tf`, `outputs.tf`
- Module: `modules/document-parser/` (the two resources' contracts)
- Provider block adapts to two planes (emulator vs real AWS) via
  `EMULATOR_ENDPOINT` in `infra/.env`
- `backend.example.hcl` documents backend shapes for manual, scriptless runs —
  the pipeline driver never reads it

## Run it

The pipeline driver is `tools/secrets.py`, wrapped by make targets at the
service root (`services/document-parser`):

```sh
make secrets-bootstrap-state    # create the state bucket for the plane
make secrets-check              # validate infra/.env, preview — no terraform
make secrets-plan
make secrets-apply              # auto on the emulator, confirm on real AWS
```

`terraform test` (this directory) verifies the stack with a mocked provider —
no emulator or AWS needed.

## Full guide

**[Infrastructure](../../docs/guides/infrastructure.md)** — the two planes,
state handling, teardown rules, and how terraform test differs from
`make secrets-test`.
