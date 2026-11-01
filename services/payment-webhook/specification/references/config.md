# Config Resolution Design

How payment-webhook resolves its config values per plane. Requirements live in [requirements.md](../requirements.md) (NFR-3/NFR-9 bounds, NFR-5 gate); the runtime contract is [design.md](../design.md)'s config planes. document-parser's config LLD is the model this follows.

**Status: declared skeleton.** Every entry point answers a loud skeleton error until its landing build connects it; nothing outside `internal/config` reads a config key yet. Landings: the dotenv reader and the flick/factory/`Resolve` wire-up with the next build; `ParameterStoreAdapter`, `SecretsManagerAdapter`, `AWSClientFactory`, and the prod plane with the AWS build.

## Source model

`Config` is the single typed contract — today the two consumed fields (`Port`, `DrainTimeout`); the credentials, `QUEUE_URL`, the bounds, and the OTel keys land with their consuming builds (consume-first: fields exist only when runtime code reads them; plane keys without a field are ignored). *Where values come from* is selected once at boot by the `ENV_TYPE` flick and composed through the factories:

- **dev** (flick `dev`): `DevSource` — the process environment over the parsed service-root `.env`. Env wins because a container ships no dotenv file and receives its values injected (compose `env_file`); locally the file is the baseline and an export still overrides it.
- **prod** (flick `prod`): `ProdSource` — **AWS exact**. The secrets blob fills first and the prefix-stripped SSM tree completes the plane; process env and dotenv never reach this path, so a stray variable cannot leak a value in. The two AWS planes are disjoint by seeding contract, and the merge enforces it: a case-insensitive key collision fails the boot loud.

`AWS_REGION` and the endpoint override are bootstrap variables, not config: `aws_client_factory` reads them from the process environment once, and credentials ride the ambient chain — never the planes.

## Resolution and failure contract

| Case | Result |
|---|---|
| `ENV_TYPE` unset, unknown, or anything but exact dev/prod | **boot fails** — the flick is strict here, a deliberate strengthening of document-parser's warn-to-dev precedent |
| `ENV_TYPE=prod` before the AWS build | **boot fails loudly** — the prod plane refuses rather than half-serving (no env-file fallback exists) |
| dev: `.env` missing at the default path | empty file plane; values come from the process environment |
| dev: `.env` malformed, or an explicitly missing default | **boot fails** naming the path and the fix (`make env`) |
| dev: blank `KEY=` entry in the file | dropped — an empty value can never win over the default |
| dev: extra file keys | ignored (consume-first) |
| `PORT` garbage or outside 1–65535 | **boot fails** naming the var — identity, not a bound; absent falls back to 8080 |
| `DRAIN_TIMEOUT` missing, blank, unreadable, or ≤ 0 | fail closed to 10 s — the publish budget + slack number (NFR-9); the publisher build re-checks the default once the budget becomes a setting |
| prod: key seeded in both the blob and SSM | **boot fails** — disjoint by seeding contract; remove the duplicates and re-apply |
| prod: fetch failure, access denied, or bad blob shape | **boot fails** naming the stack and the fix |

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

## Settled decisions

- **Go-native naming over the Python model's**: `Source` (not ConfigProvider), `DevSource`/`ProdSource` (not the dev/prod config classes), `Config` + `Resolve` (not Settings/from_provider) — recorded so nobody re-imports the Provider vocabulary; "plane" stays the prose word for both services' docs; the file names followed — `config.go` holds the typed contract and `load.go` the composition root (chats' `internal/config` is the precedent).
- **Planes own a package**: `Source` plus both plane sources declare in `internal/config/planes`; the Python model keeps them at the config root, but Go needs the boundary because the root owns `Load` and the factories must import the contract inward. Plane sources take their adapters (`NewDevSource` the `DotEnvAdapter`, `NewProdSource` the two AWS readers) — adapters parse, sources merge.
- **Consume-first**: fields exist only when runtime reads them; seeded keys without fields ride along ignored, so future fields return with their consumers.
- **The flick is strict**: unset and unknown values fail the boot (delta over the model's warn-to-dev, since a mis-flicked instance must never serve).
- **One error vocabulary at the `Load` boundary**: factories/adapters return plain descriptive errors and never values; `Load` wraps once into `ConfigError` (`Unwrap` readable).
- **No environ writes**: the dotenv reader parses in memory; the merge in `DevSource` owns precedence.
- **`DRAIN_TIMEOUT` = from the budget**: 10 s default while the publish budget stays in-code; never shorter than budget + slack once the budget is configurable too.
- **Bootstrap stays out of config**: region, endpoint, and credentials are deployment variables read once by `aws_client_factory` — never `Config` fields, never plane keys.

## Non-goals

No polling/TTL or reload (a config change means a restart), no caching layer, no per-key reads, no AppConfig/feature flags, no dotenv files in prod images, no `DOTENV_PATH` knob until a caller exists, and no AWS SDK dependency before the AWS build.
