# Load Testing

Simple k6 load tests for the payment gateway. Uses `compose.load.yml` to spin `rabbitmq + gateway + k6` isolated from the main stack.

## Scenarios

| Scenario | File | Stages | Thresholds | Payload |
|---|---|---|---|---|
| spike | `scenarios/spike.js` | 10s→20, 30s→200, 10s→0 | `p(95)<500`, `rate<0.01` | `subscription.updated` webhook |
| stress | `scenarios/stress.js` | 1m→50, 2m→100, 2m→200, 2m→300, 1m→0 | `p(99)<1000`, `rate<0.05` | `subscription.created` |
| soak | `scenarios/soak.js` | 30s at 200 + mix | `p(95)<500`, `rate<0.01` | 50/50 webhook + internal |
| internal | `scenarios/internal.js` | 30s at 200 | `p(95)<300`, `rate<0.01` | `user.cancel_subscription` internal |

All sleep `50-500ms` per VU.

## Quick Start

```bash
# from services/payments/gateway
make load-test                          # spike, 20 VUs, 30s
make load-test SCENARIO=spike TARGET_VUS=100 DURATION=60s
make load-test SCENARIO=stress
make load-test SCENARIO=soak
make load-test SCENARIO=internal
make load-down                          # down -v
```

Or directly:

```bash
docker compose -f infra/compose.load.yml up --abort-on-container-exit --exit-code-from k6
```

Set secrets if needed (defaults to `test_*`):

```bash
PADDLE_WEBHOOK_SECRET=whsec_... INTERNAL_API_KEY=s3cr3t make load-test SCENARIO=internal TARGET_VUS=50
```

## Env

| Var | Default | Used |
|---|---|---|
| `BASE_URL` | `http://payment-gateway:8080` | k6 target |
| `PADDLE_WEBHOOK_SECRET` | `test_secret` | `utils.js` HMAC |
| `INTERNAL_API_KEY` | `test_internal_key` | internal |
| `TARGET_VUS` | `20` (spike) | `options.stages` |
| `DURATION` | `30s` | `options.stages` |
| `RAMP_UP` / `RAMP_DOWN` | `10s` | stages |

## How it Works

- `utils.js` generates `Paddle-Signature: ts=...;h1=...` via `crypto.hmac('sha256', secret, ts:body)` — same as `signature.go`.
- Each VU posts to `/webhook/paddle` or `/internal/events`, checks `status 200` and `status queued`.

## When to Run

- Spike before deploy to verify `p95<500ms` under burst.
- Soak for 30m to catch `rabbitmq`/`307` leaks.
- Internal for `user.cancel_subscription` path.
