# Configuration

Every setting the service has is resolved **once at boot** from one place — a config plane — and is then frozen for the process lifetime. No request ever re-reads config, and no change takes effect until a restart.

## The plane flick

One env var decides which plane the boot reads — a two-position flick:

| `ENV_TYPE` | Plane |
|------------|-------|
| `dev` (default) | Developer plane |
| `prod` | Prod plane |
| anything else | **boot fails** — an unknown flick never serves |

## Developer plane

`DevSource` merges two sources, process environment winning over `infra/.env`:

- `infra/.env` — created by `make env` from the committed template; the compose stack feeds it to containers the same way (`env_file`)
- the process environment — so a container or a test run needs no file at all

A missing file at the default location is an empty plane (values then come from the environment); a malformed file fails the boot. Blank `KEY=` entries are dropped — an empty value can never win over a default.

## Prod plane

`ProdSource` fetches two disjoint AWS sources once, at boot:

- **Secrets Manager** — the JSON blob `detectai/payment-webhook/secrets` (the webhook secret, the license key)
- **SSM parameters** — plain settings under `/detectai/payment-webhook/`

Process env and dotenv never reach this path, so a stray variable cannot leak a value in. A key found in **both** AWS sources fails the boot loudly — they are disjoint by seeding contract. `AWS_REGION` and the endpoint overrides are bootstrap variables, not config; every AWS read builds through the SDK's default chain exactly once (see [the bootstrap table](#bootstrap-variables-config-owns-none-of-them)).

Binary compatibility instead of re-source: a key seeded after boot stays invisible until restart.

## Every key

Field names are the env keys, uppercased. Unknown keys are ignored (consume-first), so typos in unused keys degrade harmlessly. The credential is the only key with no default — its absence stops the boot.

| Key | What it controls | Default | Bad value behavior |
|-----|------------------|---------|--------------------|
| `ENV_TYPE` | plane selection | `dev` | **boot fails** |
| `PORT` | listen port | 8080 | **boot fails** outside 1–65535 |
| `PADDLE_WEBHOOK_SECRET` | the credential Paddle signs with — compared at every delivery | — | **boot fails** unless non-empty and ≥ 16 chars |
| `QUEUE_URL` | the payment-events FIFO endpoint | — | **boot fails** unless a well-formed http(s) queue URL |
| `MAX_BODY_BYTES` | raw request bound | 1 MiB | falls back to default |
| `PUBLISH_BUDGET` | the in-code enqueue budget | 5 s | falls back to default |
| `DRAIN_TIMEOUT` | graceful drain on SIGTERM | 10 s | falls back to default — then clamps up to never serve shorter than budget + 5 s slack |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | the observability gate — see below | unset → nothing emitted | set without the key → **boot fails** |
| `NEW_RELIC_LICENSE_KEY` | ingest license key for the OTLP endpoint | unset | demanded only when the endpoint is set |
| `OTEL_SERVICE_NAME` | resource name attached to all signals | `payment-webhook` | falls back to default |
| `OTEL_SERVICE_VERSION` | resource version | `dev` | falls back to default |
| `OTEL_TRACE_SAMPLE_RATIO` | fraction of traces sampled, `(0, 1]` | 1.0 | **boot fails** |

Two notes on the read bound: a bad value falls closed to the 1 MiB default, and the router then clamps the effective bound to **min(`MAX_BODY_BYTES`, 256 KiB)** — SQS cannot carry more per message, so an unshippable body answers 413 before it ever wastes a publish budget.

The split that matters: **numeric bounds and identity fields fail closed** (an unreadable value falls back to the safe default, boot continues) — **credentials, the queue URL, the port, and the sample ratio fail the boot** (a half-configured instance never serves).

## How a boot resolves

```mermaid
graph TB
    START(["start: boot"]) --> FLICK{"ENV_TYPE?"}
    FLICK -->|"dev (default)"| DEV["dev plane:<br/>process env wins over infra/.env"]
    FLICK -->|"prod"| PROD["prod plane:<br/>secrets blob + SSM tree, fetched once"]
    FLICK -->|"anything else"| DIE["boot fails: unknown flick"]
    DEV --> RESOLVE{"Resolve field by field"}
    PROD --> RESOLVE
    RESOLVE -->|"credential blank or short,<br/>port out of range, queue URL<br/>malformed, ratio outside (0, 1]"| FAIL["boot fails fast:<br/>named error"]
    RESOLVE -->|"a numeric bound unreadable"| SAFE["fail closed:<br/>the safe default wins"]
    RESOLVE -->|"every value legal"| READY["frozen for the<br/>process lifetime"]
    DIE --> END(["end"])
    FAIL --> END
    SAFE --> END
    READY --> END
```

## The config shapes, small to large

Four views over the same shapes, small to large: the composition root, the planes with their adapters, the typed fields, and the one error at the boundary. `Load`, `DeploymentFlick`, and `Resolve` are package-level functions — the `<<function>>` boxes — everything else is a real type.

### The composition root

```mermaid
classDiagram
    class Load {
        <<function>>
    }
    class DeploymentFlick {
        <<function>>
    }
    class ConfigFactory {
        +Create(flick)
    }
    class Source {
        <<interface>>
        +Get(key)
    }
    class Resolve {
        <<function>>
    }
    class Config
    Load --> DeploymentFlick : reads the flick
    Load --> ConfigFactory : Create selects the plane
    Load --> Resolve : Resolve over the source
    ConfigFactory ..> Source : hands the one plane back
    Resolve ..> Config : field by field, frozen for the process
    note for DeploymentFlick "unset resolves to dev - an unknown flick never serves"
    note for ConfigFactory "dev builds DotEnv and DevSource - prod goes through the AWSClientFactory pair, with the secrets read happening before any SSM work"
    note for Resolve "absence is a normal result on Source - Get never errors, parsing owns the verdict per field"
```

### The planes and their adapters

```mermaid
classDiagram
    class Source {
        <<interface>>
        +Get(key)
    }
    class DevSource {
        -values: map
        +Get(key)
    }
    class ProdSource {
        -values: map
        +Get(key)
    }
    class Plane {
        <<interface>>
        +Fetch()
    }
    class DotEnvAdapter {
        -values: map
        +Fetch()
    }
    class SecretsManagerAdapter {
        -client
        -name: string
        +Fetch()
    }
    class ParameterStoreAdapter {
        -client
        +Fetch()
    }
    class AWSClientFactory {
        -base: aws.Config
        +NewSecretsManagerAdapter()
        +NewParameterStoreAdapter()
    }
    Source <|.. DevSource
    Source <|.. ProdSource
    Plane <|.. SecretsManagerAdapter
    Plane <|.. ParameterStoreAdapter
    DevSource o--> DotEnvAdapter : process env wins over the file
    ProdSource o--> SecretsManagerAdapter : secrets fetched first
    ProdSource o--> ParameterStoreAdapter : the SSM tree completes
    AWSClientFactory ..> SecretsManagerAdapter : clients stay method-local
    AWSClientFactory ..> ParameterStoreAdapter
    note for DevSource "the file parses once in memory - nothing ever writes os.environ"
    note for ProdSource "one fetch per plane at boot - keys seeded on both planes fail the boot, and an env stray cannot leak in"
    note for SecretsManagerAdapter "one GetSecretValue on detectai/payment-webhook/secrets - a JSON blob of env-named keys, string values only"
    note for ParameterStoreAdapter "paged GetParametersByPath under /detectai/payment-webhook/ - prefix-stripped, plain String entries only"
    note for AWSClientFactory "the region resolves once through the SDK default chain - credentials stay ambient, never config fields"
```

### The typed fields

```mermaid
classDiagram
    class Config {
        +Port: int
        +DrainTimeout: Duration
        +PaddleSecret: string
        +MaxBodyBytes: int64
        +QueueURL: string
        +PublishBudget: Duration
        +OTelEndpoint: string
        +NewRelicKey: string
        +OTelName: string
        +OTelVersion: string
        +OTelSampleRatio: float64
    }
    note for Config "defaults - 8080, 10 s drain clamped over the budget, 1 MiB bound, 5 s budget, payment-webhook, dev, ratio 1"
    note for Config "the observability gate lives in OTelEndpoint alone - blank is a disabled boot, a set endpoint demands NewRelicKey at the credential floor"
```

### The one error at the boundary

```mermaid
classDiagram
    class Load {
        <<function>>
    }
    class ConfigError {
        -cause: error
        +Error()
        +Unwrap()
    }
    Load ..> ConfigError : the flick, the factory, and Resolve wrap here - nowhere else
    note for ConfigError "errors.Is reaches the cause through Unwrap - the boot logs one typed error and exits, nothing half-configured ever serves"
    note for Load "failures name their env key and the fix - the attempted secret is never echoed"
```

## Bootstrap variables (config owns none of them)

| Key | Role |
|-----|------|
| `AWS_REGION` | the one region every AWS composition builds against |
| `AWS_ENDPOINT_URL_SQS` | SDK-native endpoint override — ships in the template because the emulator's port is not region-derivable |
| `AWS_ENDPOINT_URL_SECRETS_MANAGER` / `_SSM` | SDK-native endpoint overrides — deployment territory, unset resolves the region default |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | the credential trio, riding the SDK default chain |

`infra/.env.example` ships the region, the SQS endpoint override, and the credential trio so `set -a` sourcing and compose `env_file` carry them along. The Secrets Manager and SSM overrides never ship: unset they resolve the region default, and pointing a boot elsewhere is deployment territory — an export on the shell, or the two names carried in `infra/.env` (the file rides `env_file` into containers). Compose forwards `QUEUE_URL` and the SQS endpoint override as whole values — dev defaults are container-shaped, a prod flick carries real endpoints, and an empty override is ignored outright (the SDK resolves the region default). The `environment:` block binds the credential trio, which is the one channel that lets a shell override a run's credentials without touching the file.

## Next Steps

- **[Secrets guide](../guides/secrets.md)** — provisioning the credentials this page reads
- **[Quick Start](quickstart.md)** — get a working local boot first
