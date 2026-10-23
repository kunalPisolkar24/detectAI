# document-parser — Secrets Terraform Stack

Provisions one thing: the Secrets Manager secret `detectai/document-parser/secrets`
(infrastructure `main.tf` holds the blob shape), seeded with the service API key as a
JSON blob: `{"API_KEY": "..."}`. The blob is the contract — consumers pull the whole
secret at boot and read keys by name, so adding keys later is a terraform-only change
with no consumer-side schema migration.

The stack does not deploy the app; the app runs via `infra/compose.yml`. This stack
manages the credential store only.

## Planes

One stack, two destinations, flipped by `EMULATOR_ENDPOINT` in `infra/.env`:

|                     | Emulator (Floci/LocalStack)       | Real AWS                       |
|---------------------|-----------------------------------|--------------------------------|
| Selected by         | `EMULATOR_ENDPOINT` set           | line empty or removed          |
| Credentials         | dummy `test`/`test`               | real AWS keys                  |
| State               | Floci S3 (`detectai-tfstate-local`) | versioned + encrypted S3     |
| Secret deletion     | instant (0-day recovery window)   | 30-day recovery window         |
| Apply               | auto-approved                     | interactive confirm            |

The provider block adapts (`providers.tf`): the emulator plane gets `test`
credentials, `skip_*` flags, and a `secretsmanager` endpoint override; the real-AWS
plane leaves all of those unset.

## Data flow

`infra/.env` → `tools/secrets.py` (parse → validate → `TF_VAR_*`) → terraform → AWS.
Terraform never reads `.env`; the Python tool never talks to AWS. Validation repeats
by design at three layers (defense-in-depth, not duplication): `tools/secrets.py`
checks human input before terraform runs, root `variables.tf` protects the stack, and
`modules/document-parser/variables.tf` protects the contract for any caller.

## Quick start

```bash
cd services/document-parser
make env             # create infra/.env from the example; set a real API_KEY
make secrets-check   # validate .env, preview plane and vars (no terraform)
make secrets-plan    # plan against the plane .env selects
make secrets-apply   # apply (auto on Floci, interactive on real AWS)
```

The state bucket must exist before the first `init`:

```bash
aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-tfstate-local --region ap-south-1
```

For real AWS, copy `backend.prod.hcl.example` → `backend.prod.hcl` and fill in the
bucket name (versioned, encrypted, access-restricted to operators running the seed).

## Testing

`terraform test` — `tests/document-parser.tftest.hcl`, mocked AWS provider, no
emulator or AWS needed: the contract name is the output, the emulator plane keeps a
0-day recovery window, and the prod plane keeps 30 days.

## Hygiene

- `api_key` is `sensitive`; the driver prints only its length.
- The state file stores `secret_string` in plaintext — the prod state bucket must be
  versioned, encrypted, and access-restricted (see `backend.prod.hcl.example`).
