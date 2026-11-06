# Config Resolution Design

How payment-webhook resolves its config values per plane. Requirements live in [requirements.md](../requirements.md) (NFR-3/NFR-9 bounds, NFR-5 gate); the runtime contract is [design.md](../design.md)'s config planes. document-parser's config LLD is the model this follows.

**Status: both planes are landed.** The dotenv reader, the flick, the factory, `Resolve`, and the service boot run the dev path today: `ENV_TYPE=dev` boots on the file-under-environment plane, a missing default `.env` is an empty plane, a malformed one fails the boot, and unknown flicks never serve. `ENV_TYPE=prod` boots the AWS planes — the Secrets Manager blob (`detectai/payment-webhook/secrets`) and the SSM prefix tree (`/detectai/payment-webhook/`) — fail loud on every named defect below, and the merge refuses key collisions across the planes.

## Source model

`Config` is the single typed contract — today the six consumed fields (`Port`, `DrainTimeout`, `PADDLE_WEBHOOK_SECRET`, `MAX_BODY_BYTES`, `QUEUE_URL`, `PUBLISH_BUDGET`); the OTel keys land with their consuming build (consume-first: fields exist only when runtime code reads them; plane keys without a field are ignored). *Where values come from* is selected once at boot by the `ENV_TYPE` flick and composed through the factories:

- **dev** (flick `dev`): `DevSource` — the process environment over the parsed `infra/.env`. Env wins because a container ships no dotenv file and receives its values injected (compose `env_file`); locally `make run` seeds the shell from the same file before the boot, so the two sources agree and the in-process merge is a no-op at launch.
- **prod** (flick `prod`): `ProdSource` — **AWS exact**. The secrets blob fills first and the prefix-stripped SSM tree completes the plane; process env and dotenv never reach this path, so a stray variable cannot leak a value in. The two AWS planes are disjoint by seeding contract, and the merge enforces it: a case-insensitive key collision fails the boot loud.

`AWS_REGION` and the endpoint overrides (`AWS_ENDPOINT_URL_SECRETS_MANAGER`, `AWS_ENDPOINT_URL_SSM` — the SDK's native service-level endpoints, the Go analog of document-parser's `EMULATOR_ENDPOINT`) are bootstrap variables, not config: every AWS composition reads them from the process environment exactly once through the SDK's default chain; credentials ride the ambient provider chain — never the planes. `infra/.env.example` ships all three so `set -a` sourcing and compose `env_file` carry them along. Locally, `make run` seeds the launch shell from the same file (`set -a`, source, `set +a`): the dev merge re-reads the file as before (env still wins in-process), and the SDK's bootstrap trio reaches the process environment, so one file carries every local value and a later container receives the same keys through compose `env_file` with no file parse.

## Resolution and failure contract

| Case | Result |
|---|---|
| `ENV_TYPE` unset, unknown, or anything but exact dev/prod | **boot fails** — the flick is strict here, a deliberate strengthening of document-parser's warn-to-dev precedent |
| `ENV_TYPE=prod` without a resolvable `AWS_REGION` | **boot fails** before any client exists, naming the region and the fix |
| dev: `.env` missing at the default path | empty file plane; values come from the process environment |
| dev: `.env` malformed, or an explicitly missing default | **boot fails** naming the path and the fix (`make env`) |
| dev: blank `KEY=` entry in the file | dropped — an empty value can never win over the default |
| dev: extra file keys | ignored (consume-first) |
| `PORT` garbage or outside 1–65535 | **boot fails** naming the var — identity, not a bound; absent falls back to 8080 |
| `PADDLE_WEBHOOK_SECRET` missing or blank in any plane | **boot fails** naming the var — mandatory in every environment (FR-1, FR-2); the attempted secret is never echoed |
| `PADDLE_WEBHOOK_SECRET` shorter than 16 characters | **boot fails** naming the var and the floor; values trim before the length check, and the trimmed value is what the plane serves |
| `MAX_BODY_BYTES` unreadable or non-positive | fail closed to the 1 MiB bound (NFR-4), never fail the boot |
| `QUEUE_URL` missing, blank, or malformed | **boot fails** naming the var and the expected shape — the SQS URL is mandatory in every plane once the publisher mounts |
| `PUBLISH_BUDGET` unreadable or non-positive | fail closed to the 5 s budget (NFR-3), never fail the boot |
| `DRAIN_TIMEOUT` missing, blank, unreadable, or ≤ 0 | fail closed to 10 s, then clamped up to never serve shorter than `PUBLISH_BUDGET` + slack (NFR-9) |
| prod: key seeded in both the blob and SSM | **boot fails** — disjoint by seeding contract; remove the duplicates and re-apply |
| prod: blob fetch failure, or a bad blob shape (no SecretString, non-JSON, non-string entry) | **boot fails** naming the secret and the fix (`make secrets-apply`) |
| prod: SSM path read failure, or a SecureString parameter under the prefix | **boot fails** naming the path or the parameter |

## File layout

| File | Role |
|---|---|
| `internal/config/interfaces.go` | contracts hub — the `Source` plane contract, declared once in `planes` and aliased here |
| `internal/config/load.go` | composition root: `Load` (flick → factory → `Resolve`) and `DeploymentFlick` |
| `internal/config/config.go` | the typed contract: `Config` fields + `Resolve`, parsing per field |
| `internal/config/errors.go` | `ConfigError` — every plane failure wraps once across the `Load` boundary |
| `internal/config/adapters/dotenv.go` | the dev file plane reader: one parse, never written to `os.environ` |
| `internal/config/adapters/parameters.go` | the prod SSM tree reader: paged, prefix-stripped, String-only |
| `internal/config/adapters/secrets_manager.go` | the prod secrets blob reader: JSON-object contract |
| `internal/config/planes/source.go` | the `Source` plane contract |
| `internal/config/planes/dev_source.go` | the dev merge: file under env |
| `internal/config/planes/prod_source.go` | the prod merge: blob + SSM with the disjointness check |
| `internal/config/factories/config_factory.go` | the flick wiring: the `ENV_TYPE` selection and each plane's adapter construction |
| `internal/config/factories/aws_client_factory.go` | region/endpoint decided once; clients stay method-local |
| `tests/unit/config/` | the config tests as one black-box package: the dotenv grammar, the dev merge, the flick wiring, `Resolve`, `Load`, and the prod planes through fakes |
| `tests/integration/config/` | the prod pull path through the real floci endpoint, skipped when the emulator is down |

## Settled decisions

- **Go-native naming over the Python model's**: `Source` (not ConfigProvider), `DevSource`/`ProdSource` (not the dev/prod config classes), `Config` + `Resolve` (not Settings/from_provider) — recorded so nobody re-imports the Provider vocabulary; "plane" stays the prose word for both services' docs; the file names followed — `config.go` holds the typed contract and `load.go` the composition root (chats' `internal/config` is the precedent).
- **Planes own a package**: `Source` plus both plane sources declare in `internal/config/planes`; the Python model keeps them at the config root, but Go needs the boundary because the root owns `Load` and the factories must import the contract inward. Plane sources take their adapters (`NewDevSource` the `DotEnvAdapter`, `NewProdSource` the two AWS readers) — adapters parse, sources merge.
- **Tests live in the tests tree**: `tests/unit/config` is one black-box `config_test` package exercising the exported API, mirroring document-parser's `tests/unit/config`; nothing lands as in-package `_test.go`, so the sources stay bloat-free and unexported behavior stays out of reach until it earns a seam.
- **Consume-first**: fields exist only when runtime reads them; seeded keys without fields ride along ignored, so future fields return with their consumers.
- **The flick is strict**: unset and unknown values fail the boot (delta over the model's warn-to-dev, since a mis-flicked instance must never serve).
- **One error vocabulary at the `Load` boundary**: factories/adapters return plain descriptive errors and never values; `Load` wraps once into `ConfigError` (`Unwrap` readable).
- **No environ writes**: the dotenv reader parses in memory; the merge in `DevSource` owns precedence.
- **`DRAIN_TIMEOUT` follows the budget**: 10 s default while the budget is the in-code 5 s; with `PUBLISH_BUDGET` configurable, `Resolve` clamps the drain up to budget + slack at the end (NFR-9).
- **Bootstrap stays out of config**: region, endpoint, and credentials are deployment variables read once by each AWS composition through the SDK's default chain — never `Config` fields, never plane keys.
- **The prod merge fetches exactly once, at `NewProdSource`**: the AWS adapters stay stateless one-call readers, secrets fetch before any SSM work, and keys seeded after boot stay invisible until a restart.
- **The two AWS readers live behind the `Plane` seam** declared in `planes` — document-parser's `AwsPlane` protocol with the same word, satisfied structurally by both adapters and filled with fakes in the tests.
- **The reader bound clamps at the wiring**: the face reads `min(MAX_BODY_BYTES, 262144)` — SQS cannot carry more per message, so an over-ceiling body answers the 413 naming the ceiling instead of surfacing mid-budget as a send fault.

- **Blob entries must be strings**: a non-string value fails the boot naming the key — sharper than document-parser's `str()` coercion, consistent with the strict flick precedent.

## Non-goals

No polling/TTL or reload (a config change means a restart), no caching layer, no per-key reads, no AppConfig/feature flags, no dotenv files in prod images, no `DOTENV_PATH` knob until a caller exists, and no compose wiring before the deployment build (document-parser's compose is the model).
