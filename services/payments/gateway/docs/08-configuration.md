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

* `infra/compose.yml` — gateway only (for `WITH_RABBITMQ=0`).
* `infra/docker/rabbitmq/standalone.yml` — shared RabbitMQ atom (single instance, `5672`, volume `rabbitmq_data`).
* `infra/docker/rabbitmq/management.yml` — UI overlay (adds `15672`, switches to `management-alpine`). Include after `standalone.yml`.
* `infra/compose.load.yml` — `rabbitmq + gateway + k6` for `make load-test` (now `include:` the two atoms above, isolated on `gateway_loadnet`).
