# Payment Webhook

Go/Gin service that receives Paddle webhooks, verifies their signatures, and forwards the events to the `payment_events.fifo` SQS queue for `worker-payments` — specification in [specification/](specification/), full documentation in [docs/](docs/README.md).

## Run

Run `make help` for the full command index.

```sh
make env         # creates infra/.env from infra/.env.example
make queue-up    # SQS emulator the queue URL points at
make run
```

## Verify

```sh
curl http://localhost:8080/api/v1/health
# {"status":"ok"}
curl http://localhost:8080/api/v1/ready
# {"status":"ready"}
```

## A signed webhook

```sh
SECRET=paddle-change-me-16-chars
TS=$(date +%s)
BODY='{"event_id":"evt_001","event_type":"subscription.created","occurred_at":"2026-01-01T00:00:00Z","data":{"subscription_id":"sub_001"}}'
SIG=$(printf '%s:%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')

curl -X POST http://localhost:8080/api/v1/webhook/paddle \
  -H "Paddle-Signature: ts=$TS;h1=$SIG" \
  -d "$BODY"
# {"status":"queued"}
```

The message now sits in `payment_events.fifo` (emulator UI on `localhost:3001`).

## Docker

```sh
make build
make up
make down
```

## Load + e2e

One `infra/.env.load` (copy the template `infra/.env.load.example`) drives both commands; the tests only send traffic and assert responses. See [tests/load/README.md](tests/load/README.md) for the scenario set.

```sh
make load-env
make load-test            # container rig: service + k6 on an isolated network
make load-e2e             # k6 only, against whatever infra/.env.load's API_URL names
make load-down
```
