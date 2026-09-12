# Load Tests

This document explains how to run load tests for the Payment Gateway.

## Overview

Load tests verify the gateway performs well under high traffic. They use k6 to simulate concurrent users.

Think of load tests as **stress tests** - they find breaking points before production does.

## Running Load Tests

```bash
# Run default load test (spike, 20 VUs)
make load-test

# Run specific scenario
make load-test SCENARIO=spike
make load-test SCENARIO=stress
make load-test SCENARIO=soak
make load-test SCENARIO=internal

# Run with custom parameters
make load-test SCENARIO=spike TARGET_VUS=100 DURATION=60s

# Clean up
make load-down
```

## Prerequisites

- **Docker** running
- **Gateway** running (or use `make load-test` which starts everything)

## Test Scenarios

### Spike Test

**What it tests:** How the gateway handles sudden traffic spikes.

| Parameter | Value |
|-----------|-------|
| Duration | ~50 seconds |
| VUs | 20 → 200 → 0 |
| Thresholds | p95 < 500ms, error rate < 1% |

**Stages:**
1. **10 seconds** - Ramp up to 20 VUs
2. **30 seconds** - Spike to 200 VUs
3. **10 seconds** - Ramp down to 0 VUs

**When to use:**
- Before deployment
- When expecting traffic spikes
- To verify auto-scaling

### Stress Test

**What it tests:** How the gateway performs under sustained high load.

| Parameter | Value |
|-----------|-------|
| Duration | ~8 minutes |
| VUs | 50 → 100 → 200 → 300 → 0 |
| Thresholds | p99 < 1000ms, error rate < 5% |

**Stages:**
1. **1 minute** - Ramp to 50 VUs
2. **2 minutes** - Ramp to 100 VUs
3. **2 minutes** - Ramp to 200 VUs
4. **2 minutes** - Ramp to 300 VUs
5. **1 minute** - Ramp down to 0 VUs

**When to use:**
- Capacity planning
- Finding breaking points
- Performance benchmarking

### Soak Test

**What it tests:** Long-running stability and memory leaks.

| Parameter | Value |
|-----------|-------|
| Duration | ~30 minutes |
| VUs | 200 (mixed traffic) |
| Thresholds | p95 < 500ms, error rate < 1% |

**Traffic mix:**
- 50% Paddle webhooks
- 50% Internal events

**When to use:**
- Before production deployment
- Catching memory leaks
- Verifying stability

### Internal Event Test

**What it tests:** Internal event path specifically.

| Parameter | Value |
|-----------|-------|
| Duration | ~30 seconds |
| VUs | 200 |
| Thresholds | p95 < 300ms, error rate < 1% |

**When to use:**
- Testing `user.cancel_subscription` path
- Verifying internal event handling
- Benchmarking internal API

## Test Architecture

```mermaid
graph TB
    subgraph "Load Test Stack"
        K6[k6] --> GW[Gateway]
        GW --> RMQ[RabbitMQ]
    end
    
    subgraph "Isolated Network"
        K6
        GW
        RMQ
    end
```

**Why isolated?**
- Load tests don't affect main stack
- Can run side-by-side with development
- Uses different ports (5673/15673)

## Test Data

### HMAC Signature Generation

Each VU generates valid Paddle signatures:

```javascript
import crypto from 'k6/crypto';

export function generateSignature(secret, body, ts) {
    const message = `${ts}:${body}`;
    const hmac = crypto.hmac('sha256', secret, message, 'hex');
    return `ts=${ts};h1=${hmac}`;
}
```

### Payload

Each VU sends a realistic payload:

```json
{
    "event_id": "evt_load_test_123",
    "event_type": "subscription.updated",
    "alert_name": "subscription_updated",
    "data": {
        "id": 123,
        "status": "active"
    }
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://payment-gateway:8080` | Gateway URL |
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` | RabbitMQ URL |
| `PADDLE_WEBHOOK_SECRET` | `test_secret` | HMAC secret |
| `INTERNAL_API_KEY` | `test_internal_key` | API key |
| `TARGET_VUS` | `20` | Virtual users |
| `DURATION` | `30s` | Test duration |

### Custom Configuration

```bash
# Custom VUs and duration
make load-test SCENARIO=spike TARGET_VUS=100 DURATION=60s

# Custom secrets
PADDLE_WEBHOOK_SECRET=whsec_my_secret make load-test SCENARIO=internal
```

## Test Structure

### VU Behavior

Each virtual user (VU):

1. **Sleeps** 50-500ms (random)
2. **Generates** HMAC signature
3. **Sends** POST request
4. **Checks** response is 200
5. **Verifies** response body is `{"status":"queued"}`

### Thresholds

| Metric | Threshold | Why |
|--------|-----------|-----|
| p95 latency | < 500ms | User experience |
| p99 latency | < 1000ms | Worst case |
| Error rate | < 1% | Reliability |

## Running Tests

### Quick Start

```bash
# From gateway directory
cd services/payments/gateway

# Start load test (spike, 20 VUs)
make load-test

# Watch output
# Press Ctrl+C to stop early
```

### Custom Scenarios

```bash
# Spike with 100 VUs for 60 seconds
make load-test SCENARIO=spike TARGET_VUS=100 DURATION=60s

# Stress test
make load-test SCENARIO=stress

# Soak test (30 minutes)
make load-test SCENARIO=soak

# Internal events only
make load-test SCENARIO=internal
```

### Direct Docker Compose

```bash
# Run load test directly
docker compose -f infra/compose.load.yml up --abort-on-container-exit --exit-code-from k6

# Clean up
docker compose -f infra/compose.load.yml down -v --remove-orphans
```

## Monitoring During Tests

### Gateway Metrics

```bash
# Watch metrics in real-time
watch -n 1 curl -s http://localhost:8080/metrics | grep http_requests_total

# Check 503 rate
watch -n 1 curl -s http://localhost:8080/metrics | grep 'code="503"'
```

### RabbitMQ Management

Open `http://localhost:15673` (load test port) to see:
- Queue depth
- Message rate
- Connection count

### k6 Output

k6 outputs real-time metrics:
- `http_req_duration` - Request latency
- `http_reqs` - Request rate
- `http_req_failed` - Failed requests

## Interpreting Results

### Good Results

```
✓ p95 < 500ms
✓ Error rate < 1%
✓ No 503 errors
✓ RabbitMQ stable
```

### Bad Results

```
✗ p95 > 500ms - Gateway is slow
✗ Error rate > 1% - Something is failing
✗ 503 errors - RabbitMQ is down or overloaded
✗ RabbitMQ queue depth growing - Consumer is slow
```

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| High p95 | Gateway overload | Scale horizontally |
| 503 errors | RabbitMQ down | Check RabbitMQ |
| High error rate | Bug or overload | Check logs |
| Memory leak | Go memory issue | Profile gateway |

## Best Practices

### Before Running

1. **Start fresh** - `make load-down` to clean up
2. **Check Docker** - Ensure Docker is running
3. **Verify gateway** - `curl http://localhost:8080/healthz`

### During Test

1. **Watch metrics** - Monitor gateway and RabbitMQ
2. **Don't interfere** - Don't restart services during test
3. **Note timestamps** - When issues occur

### After Test

1. **Clean up** - `make load-down`
2. **Review results** - Check thresholds
3. **Investigate failures** - Check logs and metrics

## Troubleshooting

### Gateway Not Starting

**Error:** `503 Service Unavailable`

**Solution:**
```bash
# Check if RabbitMQ is running
docker ps | grep rabbitmq

# Start full stack
make gateway-up
```

### k6 Fails to Start

**Error:** `Cannot connect to Docker`

**Solution:**
```bash
# Start Docker
sudo systemctl start docker

# Or on macOS
open -a Docker
```

### High Error Rate

**Possible causes:**
1. RabbitMQ overloaded
2. Gateway out of memory
3. Network issues

**What to do:**
1. Check RabbitMQ metrics
2. Check gateway logs
3. Reduce VUs and retry

### Port Conflict

**Error:** `port is already allocated`

**Solution:**
```bash
# Load test uses different ports (5673/15673)
# Check if something is using those ports
lsof -i :5673
lsof -i :15673
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Run load tests
  run: |
    cd services/payments/gateway
    make load-test SCENARIO=spike TARGET_VUS=50 DURATION=30s
  
- name: Check results
  if: failure()
  run: |
    docker compose -f infra/compose.load.yml logs k6
```

### Threshold Gates

```javascript
// In k6 options
export const options = {
    thresholds: {
        http_req_duration: ['p(95)<500'],
        http_req_failed: ['rate<0.01'],
    },
};
```

## Related Documentation

- [Testing Overview](overview.md) - Testing strategy
- [Unit Tests](unit.md) - Unit testing
- [Integration Tests](integration.md) - Integration testing
- [Observability](../operations/observability.md) - Monitoring during tests
