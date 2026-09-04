# Testing

## Commands

```bash
# Run unit tests
make test

# Run with coverage
make test-coverage

# Run integration (testcontainers rabbitmq)
make test-integration

# Run load (k6)
make load-test
```

## Unit

```
internal/domain/service_test.go
internal/infrastructure/paddle/signature_test.go
internal/infrastructure/config/config_test.go
internal/transport/http/handler_test.go
internal/monitoring/monitoring_test.go
```

`go test -v ./...` with `testify` mocks (`test/mocks/*_mock.go`).

## Integration

`test/integration/integration_test.go` uses `testcontainers-go` + `rabbitmq` module; run via `go test -v -tags=integration ./test/integration/...`.

## Load

See `test/load/README.md`:

| Scenario | File | Stages |
|---|---|---|
| `spike` | `scenarios/spike.js` | `10s:20, 30s:200, 10s:0` |
| `stress` | `scenarios/stress.js` | `1m:50..300` |
| `soak` | `scenarios/soak.js` | `30s at 200 mix` |
| `internal` | `scenarios/internal.js` | `30s at 200` |

```bash
make load-test SCENARIO=spike TARGET_VUS=100
```

Each VU posts `subscription.updated` with `utils.js` HMAC; checks `200 queued`.

## Class under test

```mermaid
classDiagram
    class ServiceTest {
        <<go test>>
        +TestProcessWebhook_Valid()
        +TestProcessWebhook_InvalidSig()
    }
    class HandlerTest {
        <<go test>>
        +TestHandleWebhook()
    }
    ServiceTest --> Service
    HandlerTest --> Handler
```
