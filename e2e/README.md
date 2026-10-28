# E2E load testing

Cross-app load testing for DetectAI. One command, one tier parameter, and it
never provisions anything: the services under test are whatever the target
environment already runs.

```bash
make -C e2e load TIER=smoke TARGET=prod
```

## Quick start

```bash
# 1. Create the target file for an environment (once).
make -C e2e target-init TARGET=prod
$EDITOR e2e/targets/.env.prod

# 2. Start the service locally, the way it normally runs.
make -C e2e up SERVICE=document-parser

# 3. Prove the plumbing works before trusting any numbers.
make -C e2e load TIER=preflight TARGET=local
make -C e2e load TIER=smoke TARGET=local

# 4. Clean up.
make -C e2e down SERVICE=document-parser
```

## Tiers

The tier is the load profile. Every service's existing k6 scripts already
encode their own shape, so a tier mostly selects which script runs.

| Tier | Shape | Wall clock | Answers |
|---|---|---|---|
| `preflight` | no load, 3s timeout | ~5s | is the target reachable at all |
| `smoke` | 2 VUs x 2 iterations | ~10s | is it correct |
| `contract` | the service's own negative profile | ~10s - 1m | does it still refuse what it must refuse |
| `load` | the service's sustained profile | ~20s - 3m | does it hold under expected traffic |
| `stress` | beyond expected capacity | ~1-10m | where does it break |
| `soak` | long, low rate | ~30m | leaks and drift |

`preflight` and `smoke` are the ones to reach for first. `contract` is the
cheapest check there is — a rejection never reaches the backend — and a
regression there silently lets bad input through, so it is worth running on
every deploy even though it is not a load profile.

A tier is a default, not a cage: `VUS`, `DURATION`, `RPS`, `STAGES`, `MAX_VUS`
and `ITERATIONS` override it, so an intermediate shape never needs a new tier.
`SCRIPT=` overrides the tier's script where the ladder does not cover it.

```bash
make -C e2e load TIER=load TARGET=prod VUS=25 RPS=50
```

## Parameters

| Parameter | Meaning | Default |
|---|---|---|
| `TIER` | `preflight`, `smoke`, `load`, `stress` or `soak` | `smoke` |
| `TARGET` | an environment file in `targets/.env.<name>` | `local` |
| `SERVICE` | one service instead of every wired one | all wired ones |
| `SCRIPT` | the script a tier runs, for the cases the ladder does not cover | the tier's own |

## Targets

A target file describes one environment: where the services live and how to
authenticate against them. The files are gitignored; `.env.example` is the
committed template.

```
e2e/targets/.env.example     template
e2e/targets/.env.local       a service on this machine
e2e/targets/.env.floci       the prod compose stack on the Floci emulator
e2e/targets/.env.prod        a real deployment
```

Each service reads only the keys it needs, so one file grows as more services
are wired up. From inside the k6 container, a service published on the Docker
host is `host.docker.internal:<host port>`; remote targets use their real
hostname.

## How it works

The per-service load rigs under `services/*/tests/load/` (compose templates
under `services/*/infra/`) keep working standalone
(`make -C services/document-parser load-test`). This harness runs those same
scripts against an existing deployment instead of starting a rig — for the
services wired above; document-parser is not wired for remote runs here, its
remote flow is the service-level one (set `API_URL` in its
`services/document-parser/infra/.env.load`, run
`make -C services/document-parser load-e2e`):

```
docker compose --env-file targets/.env.<target> -p e2e-<service> \
  run --rm --no-deps k6 run <script>
```

`--no-deps` is the whole trick: the service under test and its datastores are
never started, so a remote run creates no infrastructure. The remote run gets
its own compose project (`e2e-<service>`) so it can never disturb a local rig.

Observability in remote mode is the target's business: a deployed stack
already exports its own traces, metrics and logs. `WITH_OBSERVABILITY` only
applies to the local rigs, where the collector is started for the run.

Some services need more than an endpoint to be measured correctly. The
payment gateway publishes to RabbitMQ, and how the delivery is proved depends
on the broker: a queue nothing consumes can be counted directly, while a
queue with a live consumer has to be proved from the gateway's own publish
counters. `GATEWAY_LOAD_QUEUE_PROOF` picks the mode per target.

The web's load rig answers from a mock backend, so its latency budget is
milliseconds. Against a real deployment the analyze endpoint waits on real
inference and takes seconds, so `WEB_ANALYZE_P95_MS` and
`WEB_ANALYZE_P99_MS` carry the budget a target is held to. The scripts that
do not reach a backend — landing, the auth surface, the rejection matrix —
keep the same budget in both places.

The web's scripts also sign in with real accounts, so a target needs them
planted once: the free account carries no subscription, the premium one an
ACTIVE one. The load rig seeds them; a deployed target needs them created by
hand. The target file carries the credentials.

The web's analyze path also needs a chat that exists. The rig's mock backend
accepts any chat id, but a real chats service answers `NOT_FOUND` for one
that does not exist, and the analyze route turns that into a 500.
`WEB_CHAT_ID` points the requests at a chat that belongs to the user the
request carries.

## Wiring up another service

1. Generalize the target value in the service's `infra/compose.load.yml`:
   `FOO=hardcoded` becomes `FOO=${FOO:-hardcoded}`. Every other knob in those
   files is already in that form.
2. Add `REMOTE=1` and `TARGET_ENV_FILE` support to the service's `Makefile`
   (see `services/document-parser/Makefile`).
3. Add the service's endpoints to `e2e/targets/.env.example`.
4. Add the tier mapping to `e2e/Makefile`:
   `TIER_SCENARIO_<service>_<tier> := <scenario>`. A service whose scripts are
   named after what they exercise rather than after the profile they run with
   also needs `TIER_SCRIPT_<service>_<tier> := <script>`.
5. Add the service to `WIRED_SERVICES`, and its `up`/`down` targets to
   `SERVICE_UP_<service>` / `SERVICE_DOWN_<service>`.

## Commands

| Command | Does |
|---|---|
| `load` | run the tier against the target |
| `preflight` | reachability only |
| `target-init` | create `targets/.env.<target>` from the template |
| `up` / `down` | start/stop a service on its own compose file, and clean the runner projects |
| `help` | tiers, parameters, wired services, target files |
