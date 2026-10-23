# Load Testing

Simple k6 load tests for the payment gateway. Uses `compose.load.yml` to spin `rabbitmq + gateway + k6` isolated from the main stack.

## Scenarios

| Scenario | File | Stages | Thresholds | Payload |
|---|---|---|---|---|
| smoke | `scenarios/smoke.js` | 2 VUs, 2 iterations | `checks==1.0` | one valid signed webhook, queue no-loss proof |
| spike | `scenarios/spike.js` | 10s→20, 30s→200, 10s→0 | `p(95)<500`, `rate<0.06` (5% invalid-sig noise), `checks==1.0` | profile mix + 5% noise, queue no-loss proof |
| stress | `scenarios/stress.js` | 1m→50, 2m→100, 2m→200, 2m→300, 1m→0 | `p(99)<1000`, `rate<0.05`, `checks==1.0` | `subscription.created`, queue no-loss proof |
| soak | `scenarios/soak.js` | 30s at 200 + mix | `p(95)<500`, `rate<0.06` (noise), `checks==1.0` | profile mix + 5% noise, runtime + no-loss proof |
| internal | `scenarios/internal.js` | 30s at 200 | `p(95)<300`, `rate<0.01`, `checks==1.0` | `user.cancel_subscription` internal, queue no-loss proof |
| negative | `scenarios/negative.js` | 5 VUs, 70 iters (7 cases) | `checks==1.0` | 401/400 rejections + 200 tolerance cases |
| chaos | `scenarios/chaos.js` | 30s→20, 3m hold, 30s→0 | `checks>0.99`, `p(95)<1000` | steady webhook, RabbitMQ stopped mid-run via `make load-test-chaos` |

Spike/soak sleep `100ms`/`500ms` per VU; stress `50ms`; chaos `200ms`. Spike and soak cycle `lib/payloads.js` profiles deterministically by iteration (webhook small/medium/large/near-limit, internal small/medium) with every 20th request as invalid-signature noise.

## Quick Start

```bash
# from services/payments/gateway
make load-test                          # spike, 20 VUs, 30s
make load-test SCENARIO=smoke           # happy path, 2 VUs, 2 iterations
make load-test SCENARIO=spike TARGET_VUS=100 DURATION=60s
make load-test SCENARIO=stress
make load-test SCENARIO=soak
make load-test SCENARIO=internal
make load-test-negative                   # rejection paths (70 iters, fast)
make load-test-chaos                      # RabbitMQ outage mid-run (~5min)
make load-down                          # down -v
```

## Running Against an Existing Deployment

The rig above is self-contained: it starts its own broker and gateway. To measure a deployment that is already running -- a local stack, the Floci stack, prod -- run the same scripts against it instead. Nothing is provisioned: the k6 container runs with `--no-deps`, so the gateway and its broker are never started by the load run.

```bash
# The target file carries the endpoint and any credentials.
# See e2e/targets/.env.example for the template.
make load-test REMOTE=1 TARGET_ENV_FILE=../../../e2e/targets/.env.prod SCENARIO=spike
```

`REMOTE=1` switches the run to `docker compose run --rm --no-deps k6`, in its own compose project (`e2e-payment-gateway`) so it never disturbs a running local rig. The profile knobs (`TARGET_VUS`, `DURATION`, `RAMP_UP`, `RAMP_DOWN`, `SMOKE_VUS`, `SMOKE_ITERATIONS`) work exactly as they do in rig mode.

Observability is the target's business here: a deployed stack already exports its own traces, metrics and logs, so `WITH_OBSERVABILITY` is ignored in remote mode and says so. `SCENARIO=chaos` is refused in remote mode too: it stops the RabbitMQ container mid-run, which only works against the rig.

Use the cross-app harness in `e2e/` to drive this and the other services together:

```bash
make -C e2e load TIER=smoke TARGET=prod
```

### How the delivery is proved

The gateway publishes to RabbitMQ synchronously and only answers `200 {"status":"queued"}` after the broker acked the message, so a 200 with `queued` is already proof the broker took it. The teardown adds the delivery proof the configured mode asks for.

| `GATEWAY_LOAD_QUEUE_PROOF` | Proves | Use when |
|---|---|---|
| `exact` (default) | the broker's queue depth grew by exactly the gateway's publish count | an idle queue that nothing consumes -- the rig |
| `at_least` | the queue depth grew by at least the publish count | other producers write to the same queue |
| `off` | the gateway's `status="success"` publish count grew and `status="error"` did not | a live consumer drains the queue, so a depth comparison can only produce false failures |

`off` gives up only the "physically still sitting in the queue" count. The broker's management API is not read at all in that mode, so a target whose broker does not expose it (Amazon MQ often does not) still works.

## Observability (opt-in)

```bash
export NEW_RELIC_LICENSE_KEY="..."      # ingest key, never commit
make load-test SCENARIO=spike WITH_OBSERVABILITY=1 TARGET_VUS=20
```

Adds `otel-collector-loadtest` on the load network (scrapes `/metrics`,
per-container CPU/mem/net via `docker.sock`, exports OTLP to EU).
`ENV_TYPE` stays `dev` — telemetry is labeled
`deployment.environment=loadtest`, so k6 traffic shows up in the
`detectai-payment-gateway (loadtest)` dashboard, never prod. Default
`WITH_OBSERVABILITY=0` runs fully offline.

Or directly:

```bash
docker compose -f infra/compose.load.yml up --abort-on-container-exit --exit-code-from k6
```

Set secrets if needed (defaults to `test_*`):

```bash
PADDLE_WEBHOOK_SECRET=whsec_... INTERNAL_API_KEY=s3cr3t make load-test SCENARIO=internal TARGET_VUS=50
```

Load publishes `5673/15673` (not `5672/15672`), so it runs side-by-side with `make gateway-up`. Override via `RABBITMQ_PORT` / `RABBITMQ_UI_PORT`.

## Env

| Var | Default | Used |
|---|---|---|
| `GATEWAY_BASE_URL` | `http://payment-gateway:8080` | k6 target (`BASE_URL` still works as the older name) |
| `GATEWAY_LOAD_QUEUE_PROOF` | `exact` | `exact` / `at_least` / `off` -- how the delivery is proved |
| `GATEWAY_LOAD_SUB_ID` / `_USER_ID` / `_PADDLE_SUB_ID` | `sub_123` / `user-123` / `sub_456` | the records the events are addressed to |
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` | gateway dial (container port, unaffected by host publish) |
| `RABBITMQ_PORT` / `RABBITMQ_UI_PORT` | `5673` / `15673` (load), `5672` / `15672` (main) | host publish |
| `PADDLE_WEBHOOK_SECRET` | `test_secret` | `utils.js` HMAC |
| `INTERNAL_API_KEY` | `test_internal_key` | internal |
| `TARGET_VUS` | `20` (spike) | `options.stages` |
| `DURATION` | `30s` | `options.stages` |
| `SMOKE_VUS` / `SMOKE_ITERATIONS` | `2` / `2` | `smoke` scenario size |
| `WITH_OBSERVABILITY` | `0` | `1` → also start `otel-collector-loadtest`, push to New Relic as `loadtest` |
| `RABBITMQ_MGMT_URL` / `USER` / `PASS` | `http://rabbitmq:15672`, `guest` | queue no-loss proof via management API |
| `RABBITMQ_QUEUE` | `payment_events` | queue checked by teardown |
| `SOAK_MAX_GOROUTINE_GROWTH` / `SOAK_MAX_RSS_GROWTH_PCT` | `100` / `50` | soak leak budgets |
| `RAMP_UP` / `RAMP_DOWN` | `10s` | stages |

## How it Works

- `utils.js` generates `Paddle-Signature: ts=...;h1=...` via `crypto.hmac('sha256', secret, ts:body)` — same as `signature.go`.
- Each VU posts to `/webhook/paddle` or `/internal/events`, checks the expected status (`200` + `status queued`, or `401`/`400` for rejection cases).
- `lib/rabbitmq.js` proves end-to-end delivery: each scenario records the queue depth plus the gateway `payment_events_published_total{status="success"}` and `{status="error"}` counters in `setup()` and asserts in `teardown()`. Both numbers come from the system under test (k6 VU state is invisible to teardown). The load stack runs no consumer, so any silent loss fails the run. `GATEWAY_LOAD_QUEUE_PROOF=off` proves the same thing from the gateway's counters alone, for a broker with a live consumer.
- `lib/runtime.js` scrapes `/metrics` for soak leak detection (goroutine + RSS growth budgets).
- `scenarios/negative.js` locks rejection behavior: tampered/missing signature → `401`, wrong/missing internal key → `401`, oversized body → `400`, unknown event type and malformed JSON → `200` (tolerant ingest).

## When to Run

- Spike before deploy to verify `p95<500ms` under burst.
- Negative after touching validation, auth, or limits.
- Chaos before releases that touch RabbitMQ wiring or publish paths.
- Soak for 30m to catch goroutine/memory leaks (teardown asserts growth budgets).
