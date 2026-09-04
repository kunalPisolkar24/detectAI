# Architecture

## High-level

```mermaid
graph LR
    Paddle --> GW[Gateway]
    WebApp --> GW
    GW --> RMQ[(RabbitMQ)]
    RMQ --> Worker[worker-payments]
    Worker --> DB[(Postgres)]
    RMQ --> DLQ[(DLQ)]
    RMQ --> RQ[(Retry)]
    RQ --> RMQ
```

Stateless Go `gin` service, no DB. Forwards raw JSON (`1 MiB`, `5s` timeout) with publisher confirms.

## Sequence

```mermaid
sequenceDiagram
    participant Paddle
    participant GW as Gateway
    participant Val as Validator
    participant RMQ as RabbitMQ
    Paddle->>GW: POST webhook
    GW->>Val: Validate signature
    alt invalid
        GW-->>Paddle: 401 Invalid
    else valid
        GW->>RMQ: Publish
        RMQ-->>GW: Acked
        GW-->>Paddle: 200 queued
    end
```

`ProcessWebhook` vs `ProcessInternalEvent` share `event_id` tracing; both use `1 MiB` limit and persistent `application/json`.

## DLQ / Retry

```mermaid
graph TB
    MainQ[ payment_events ] --> Rex[ retry_exchange ]
    Rex --> RQ[ retry queue TTL 5000 ]
    RQ --> MainQ
    MainQ --> DLX[ dlx ]
    DLX --> DLQ[ dlq ]
```

* `payment_events` → `retry_exchange` (TTL 5s) → `payment_events` (retry)
* `payment_events` → `dlx` → `dlq` (dead-letter after max retries)
* Quorum vs classic via `RABBITMQ_QUEUE_TYPE` (`quorum` in prod, `classic` locally).

## Class view

```mermaid
classDiagram
    class Service {
        +ProcessWebhook(raw, sig): error
        +ProcessInternalEvent(raw, key): error
    }
    class Validator {
        +ValidatePaddleSignature(ts, h1, body): error
        +ValidateInternalKey(key): error
    }
    class RabbitMQProducer {
        +Publish(ctx, body): error
        +Close()
    }
    class Config {
        +PaddleWebhookSecret: string
        +InternalAPIKey: string
        +RabbitMQURL: string
    }
    class HTTPHandler {
        +HandleWebhook(c)
        +HandleInternal(c)
        +Healthz(c)
        +Readyz(c)
    }
    Service --> Validator
    Service --> RabbitMQProducer
    HTTPHandler --> Service
    Config --> Service
```

`internal/domain/service.go` implements `ports.Service`; `infrastructure/rabbitmq/producer.go` wraps `amqp091-go` with confirms; `transport/http/handler.go` validates then calls service.

See `02-validation.md` for HMAC details and `03-internals.md` for RabbitMQ code.
