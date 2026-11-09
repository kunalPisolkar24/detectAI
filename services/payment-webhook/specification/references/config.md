# Config Resolution Design

How payment-webhook resolves its config values per plane. Requirements live in [requirements.md](../requirements.md); the runtime contract is [design.md](../design.md)'s config planes; the user-facing table is [docs/getting-started/configuration.md](../../docs/getting-started/configuration.md).

**Status: both planes are landed.** `ENV_TYPE=dev` boots on the file-under-environment plane — a missing default `.env` is an empty plane, a malformed one fails the boot, unknown flicks never serve. `ENV_TYPE=prod` boots the AWS planes — the Secrets Manager blob (`detectai/payment-webhook/secrets`) and the SSM prefix tree (`/detectai/payment-webhook/`) — fails loud on every named defect below, and the merge refuses key collisions across the planes.

## Source model

`Config` is the single typed contract — today the eleven consumed fields (`Port`, `DrainTimeout`, `PaddleSecret`, `MaxBodyBytes`, `QueueURL`, `PublishBudget`, plus the OTel five); *where values come from* is selected once at boot by the `ENV_TYPE` flick:

- **dev**: `DevSource` — the process environment over the parsed `infra/.env`. Env wins because a container ships no dotenv file and receives its values injected (compose `env_file`); locally `make run` seeds the shell from the same file, so the in-process merge is a no-op at launch.
- **prod**: `ProdSource` — **AWS exact**. The secrets blob fills first, the prefix-stripped SSM tree completes the plane; process env and dotenv never reach this path, so a stray variable cannot leak a value in. The merge enforces the disjointness: a case-insensitive key collision fails the boot loud.

`AWS_REGION` and the endpoint overrides (`AWS_ENDPOINT_URL_SECRETS_MANAGER`, `AWS_ENDPOINT_URL_SSM`) are bootstrap variables, not config: every AWS composition reads them from the process environment exactly once through the SDK's default chain; credentials ride the ambient provider chain — never the planes. `infra/.env.example` ships the region, the endpoints, and the dummy credential pair so `set -a` sourcing and compose `env_file` carry them along.

## Resolution and failure contract

| Case | Result |
|---|---|
| `ENV_TYPE` unset or empty | the dev plane — the flick falls back instead of failing |
| `ENV_TYPE` unknown, or not exactly `dev`/`prod` | **boot fails** — `qa` and `DEV` never serve |
| `ENV_TYPE=prod` without a resolvable `AWS_REGION` | **boot fails** before any client exists, naming the region and the fix |
| dev: `.env` missing at the default path | empty file plane; values come from the process environment |
| dev: `.env` malformed, or an explicitly missing default | **boot fails** naming the path and the fix (`make env`) |
| dev: blank `KEY=` entry in the file | dropped — an empty value can never win over the default |
| dev: extra file keys | ignored (consume-first) |
| `PORT` garbage or outside 1–65535 | **boot fails** naming the var — identity, not a bound; absent falls back to 8080 |
| `PADDLE_WEBHOOK_SECRET` missing or blank in any plane | **boot fails** naming the var — mandatory everywhere; the attempted secret is never echoed |
| `PADDLE_WEBHOOK_SECRET` shorter than 16 chars | **boot fails** naming the var and the floor; values trim before the check |
| `MAX_BODY_BYTES` unreadable or non-positive | fail closed to the 1 MiB bound (NFR-4), never fail the boot |
| `QUEUE_URL` missing, blank, or malformed | **boot fails** naming the var and the expected SQS URL shape |
| `PUBLISH_BUDGET` unreadable or non-positive | fail closed to the 5 s budget (NFR-3), never fail the boot |
| `DRAIN_TIMEOUT` missing, unreadable, or ≤ 0 | fail closed to 10 s, then clamped up to never serve shorter than budget + slack (NFR-9) |
| prod: key seeded in both the blob and SSM | **boot fails** — disjoint by seeding contract; remove duplicates and re-apply |
| prod: blob fetch failure, or a bad blob shape (no SecretString, non-JSON, non-string entry) | **boot fails** naming the secret and the fix (`make secrets-apply`) |
| prod: SSM read failure, or a SecureString under the prefix | **boot fails** naming the path or the parameter |
| `OTEL_EXPORTER_OTLP_ENDPOINT` blank | normalized to unset — a legitimate disabled boot in every plane |
| `OTEL_EXPORTER_OTLP_ENDPOINT` set without `NEW_RELIC_LICENSE_KEY` at ≥ 16 chars | **boot fails** naming the pair and the floor |
| `OTEL_TRACE_SAMPLE_RATIO` unreadable or outside (0, 1] | **boot fails** naming the var — nothing fail-closes a bad sample |
| `OTEL_SERVICE_NAME`/`OTEL_SERVICE_VERSION` blank | fail closed to the `payment-webhook` / `dev` defaults |

## File layout

| File | Role |
|---|---|
| `internal/config/interfaces.go` | contracts hub — the `Source` plane contract, declared in `planes` and aliased here |
| `internal/config/load.go` | composition root: `Load` (flick → factory → `Resolve`) and `DeploymentFlick` |
| `internal/config/config.go` | the typed contract: `Config` fields + `Resolve`, parsing per field |
| `internal/config/errors.go` | `ConfigError` — every plane failure wraps once across the `Load` boundary |
| `internal/config/adapters/dotenv.go` | the dev file plane reader: one parse, never written to `os.environ` |
| `internal/config/adapters/parameters.go` | the prod SSM tree reader: paged, prefix-stripped, String-only |
| `internal/config/adapters/secrets_manager.go` | the prod secrets blob reader: JSON-object contract |
| `internal/config/planes/{source,dev_source,prod_source}.go` | the plane contract + the dev merge + the prod merge with the disjointness check |
| `internal/config/factories/{config_factory,aws_client_factory}.go` | the flick wiring; region/endpoints decided once, clients method-local |
| `tests/unit/config/` | one black-box package: the dotenv grammar, both merges, the flick, `Resolve`, `Load`, and the prod planes through fakes |
| `tests/integration/config/` | the prod pull path through the real floci endpoint, skipped when the emulator is down |

## Settled decisions

- **Go-native naming**: `Source`, `DevSource`/`ProdSource`, `Config` + `Resolve` — not the Python model's Provider vocabulary; "plane" stays the prose word. `config.go` holds the typed contract, `load.go` the composition root (chats' precedent).
- **Planes own a package** (`internal/config/planes`) — the root owns `Load` and the factories must import the contract inward; adapters parse, sources merge.
- **Tests live in the tests tree**, one black-box package over the exported API — nothing lands as in-package `_test.go`.
- **Consume-first**: fields exist only when runtime reads them; seeded keys without fields ride along ignored.
- **The flick is strict**: unset → dev, unknown → boot fails (a mis-flicked instance must never serve).
- **One error vocabulary at the `Load` boundary**: factories/adapters return plain descriptive errors, never values; `Load` wraps once into `ConfigError`.
- **No environ writes**: the dotenv reader parses in memory; the `DevSource` merge owns precedence.
- **Bootstrap stays out of config**: region, endpoints, and credentials are read once by each AWS composition through the SDK's default chain — never `Config` fields.
- **The prod merge fetches exactly once, at `NewProdSource`**: secrets before SSM; keys seeded after boot stay invisible until a restart.
- **The two AWS readers live behind the `Plane` seam** declared in `planes`, satisfied structurally and filled with fakes in the tests.
- **The reader bound clamps at the wiring**: the route reads `min(MAX_BODY_BYTES, 262144)` — an over-ceiling body answers 413 naming the ceiling instead of surfacing mid-budget as a send fault.
- **The OTel endpoint is the sole observability gate**: blank → unset; a set endpoint demands the license key at the same 16-char floor (`secrets.toml`'s `[requires]` mirrors the gate for seeding). The ratio fails loud; identity fields fail closed.
- **Blob entries must be strings**: a non-string value fails the boot naming the key — sharper than the Python `str()` coercion.

## Non-goals

No polling/TTL or reload (a config change means a restart), no caching layer, no per-key reads, no AppConfig/feature flags, no dotenv files in prod images, no `DOTENV_PATH` knob until a caller exists, and no seeding contract changes.

## Compose

`infra/compose.yml` serves both flicks in one file through interpolation: `ENV_TYPE` rides `infra/.env` (unset falls back to the app's dev default in-process). The compose block carries bootstrap variables only — the `PORT: 8080` pin (the healthcheck never moves), the queue repaint (`QUEUE_URL` + `AWS_ENDPOINT_URL_SQS` over `QUEUE_HOST`/`ELASTICMQ_PORT` overrides), and the credential trio. Region and the SM/SSM endpoint overrides ride `infra/.env` alone, shaped for the container (`host.docker.internal:4566`); wiped there, they fall through the SDK default chain to real AWS. Config values stay plane-owned: dev carries them via `env_file`, prod re-reads them from the SM/SSM trees and ignores process env by contract. `QUEUE_URL` in `infra/.env` is container-shaped; `make run` repaints it for the host, so one file serves seeding, containers, and host runs without flips.
