# Running the service

Everything here runs from `services/payment-webhook`; `make help` prints the
raw index and `docs/reference/make.md` annotates every row.

## The local loop

```sh
make env         # infra/.env from the template — only if missing, never overwrites
make queue-up    # ElasticMQ: SQS on :9324, UI on :3001
make run         # sources infra/.env, repaints QUEUE_URL to localhost, runs the API
```

Then edit `infra/.env` and set a real `PADDLE_WEBHOOK_SECRET` — the boot
enforces a 16-character floor (the example placeholder legally passes it,
which is exactly why it pays to replace it). In Paddle's dashboard this is
the value the webhook destination pairs with.

Verify with the open probes:

```sh
curl http://localhost:8080/api/v1/health   # {"status":"ok"}
curl http://localhost:8080/api/v1/ready    # {"status":"ready"}
```

## A signed webhook

Sign `<ts>:<raw body>` with the secret and send:

```sh
SECRET=paddle-change-me-16-chars
TS=$(date +%s)
BODY='{"event_id":"evt_001","event_type":"subscription.created","occurred_at":"2026-01-01T00:00:00Z","data":{"subscription_id":"sub_001"}}'
SIG=$(printf '%s:%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')

curl -X POST http://localhost:8080/api/v1/webhook/paddle \
  -H "Paddle-Signature: ts=$TS;h1=$SIG" \
  -H "Content-Type: application/json" \
  -d "$BODY"
# {"status":"queued"}
```

The message now sits in `payment_events.fifo` (emulator UI on `localhost:3001`),
grouped under `subscription:sub_001`. Per Paddle's own schema, `canceled`
takes a single `l`, exactly as Paddle's lifecycle events spell it.

## Docker instead

```sh
make build
make up     # queue-up, then compose up detached
curl http://localhost:8080/api/v1/health
make down
```

The compose stack reads `infra/.env` wholesale, so the same config drives
both ways of running — and the container reaches the emulator over
`host.docker.internal` without any repainting.

## The emulator

- `make queue-up` starts ElasticMQ and **leaves a running emulator untouched,
  never recreated** — its state is in-memory and a recreate would drop it.
- `make queue-down` tears the emulator down; `make clean` takes down the
  service stack and the emulator together (networks and volumes included)
  for odd failures with nothing obviously changed.
- `make logs` / `make ps` for a running stack misbehaving or "is it even up?"

## The make-target index

| Target | What it does |
|--------|--------------|
| `make run` | sources `infra/.env`, repaints `QUEUE_URL` from `host.docker.internal` to `localhost`, runs the API |
| `make env` | copies `infra/.env.example` → `infra/.env` **if missing** |
| `make tidy` | resolves and updates `go.mod`/`go.sum` |
| `make vet` | `go vet ./...` — before pushing anything |
| `make build` / `make up` / `make down` | the docker lifecycle (image `detectai-payment-webhook`) |
| `make queue-up` / `make queue-down` | the ElasticMQ emulator |
| `make logs` / `make ps` / `make clean` | compose diagnostics and full cleanup |
| `make test` / `test-unit` / `test-integration` | the test suites — [references/testing.md](testing.md) |
| `make load-env` / `load-test` / `load-e2e` / `load-down` | the k6 rig — [references/testing.md](testing.md) |
| `make secrets-*` | the tfctl-driven secrets plane — [references/infra.md](infra.md) |

## Deployment shape

AWS Lambda behind API Gateway (synchronous proxy integration) runs the same
container image as local compose, fronted by the Lambda Web Adapter — the
app, its config planes, and its tests stay unmodified across runtimes. The
door shapes the numbers: 512 MB memory, 10 s function timeout (above the 5 s
publish budget, so the shaped 503 wins the race), API GW integration timeout
≤ 29 s. Lambda has no probes — the platform owns availability; the probe
routes stay in the contract for local parity.
