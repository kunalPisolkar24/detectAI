# Configuration

## Env table

| Var | Default | Required | Notes |
|---|---|---|---|
| `PADDLE_WEBHOOK_SECRET` | — | yes | `whsec_...`, 16+ chars, used for HMAC |
| `INTERNAL_API_KEY` | — | yes | `s3cr3t`, secures `/internal/events` |
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` | no | `amqp091-go` dial |
| `RABBITMQ_QUEUE_TYPE` | `classic` | no | `classic` locally, `quorum` in prod |
| `PORT` | `8080` | no | `gin` listen |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(empty)* | no | if empty, tracing disabled |
| `OTEL_SERVICE_NAME` | `payment-gateway` | no | resource name |

## Validation

`internal/infrastructure/config/config.go` ensures:

* `PADDLE_WEBHOOK_SECRET` and `INTERNAL_API_KEY` non-empty, `>=16`.
* `PORT` `1..65535`, `RABBITMQ_QUEUE_TYPE` either `classic` or `quorum`.

Failed validation → service exits `log.Fatal`.

## Compose

* `infra/compose.yml` (`name: gateway`) — gateway only, no `include`, no `depends_on` (app fast-fails `503` when the broker is down instead of gating startup).
* `infra/docker/rabbitmq/standalone.yml` — shared RabbitMQ atom (single instance, `${RABBITMQ_PORT:-5672}:5672`, volume `rabbitmq_data`).
* `infra/docker/rabbitmq/management.yml` — UI overlay (adds `${RABBITMQ_UI_PORT:-15672}:15672`, switches to `management-alpine`). Include after `standalone.yml`.
* `infra/compose.load.yml` (`name: gateway-load`) — `rabbitmq + gateway + k6` for `make load-test` (`include:` the two atoms above, isolated on `gateway_loadnet`). Load publishes `5673/15673` (via `Makefile`), so it runs side-by-side with the main stack (`5672/15672`).

Opt-out (`make gateway-up WITH_RABBITMQ=0`) needs an external `RABBITMQ_URL` — without it the gateway fast-fails `503` (`Retry-After: 5`). `WITH_UI=1` requires `WITH_RABBITMQ=1` and is ignored otherwise (with a warning).
