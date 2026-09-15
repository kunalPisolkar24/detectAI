# Load Testing

Simple k6 load tests for the document parser. Uses `infra/compose.load.yml` to spin `document-parser + k6` isolated from the main stack.

## Scenarios

| Scenario | Mode | Stages | Thresholds | Payload |
|---|---|---|---|---|
| `vus` | `ramping-vus` | `RAMP→VUS`, `DURATION→VUS`, `RAMP→0` | `p(95)<1500`, `p(99)<3000`, `rate==0` | random `sample.pdf`/`sample.docx`/`sample.txt` |
| `rps` | `ramping-arrival-rate` | `RAMP→RPS`, `DURATION→RPS`, `RAMP→0` | `p(95)<1500`, `p(99)<3000`, `rate==0` | same, open-model arrival |
| `health` | `constant-vus` | `5 VUs` at `30s` | `p(95)<1500`, `p(99)<3000` | `GET /health` |

All use `THRESHOLDS` `http_req_duration p(95)<1500 p(99)<3000` and `errors rate==0`. Sleep `1-3s` per VU in `vus` mode.

## Quick Start

```bash
# from services/document-parser
make load-test                          # vus mode, 5 VUs, 10s hold, 5s ramp (health 5 VUs 30s)
make load-test VUS=20 DURATION=1m RAMP_TIME=30s
make load-test MODE=rps VUS=50 RPS=100 DURATION=2m
make load-test MODE=vus VUS=100
make load-down                          # down -v
```

Or directly:

```bash
docker compose -f infra/compose.load.yml up --abort-on-container-exit --exit-code-from k6
```

Set env if needed:

```bash
MODE=rps VUS=50 RPS=100 DURATION=2m RAMP_TIME=10s make load-test
API_URL=http://document-parser:8000 make load-test
```

## Env

| Var | Default | Used |
|---|---|---|
| `API_URL` | `http://document-parser:8000` | k6 target |
| `MODE` | `vus` | `vus` → `ramping-vus`, `rps` → `ramping-arrival-rate` |
| `VUS` | `5` | `options.stages` target |
| `DURATION` | `10s` | hold duration |
| `RAMP_TIME` | `5s` | ramp up/down |
| `RPS` | `10` | `ramping-arrival-rate` target |

## How it Works

- `script.js` preloads `fixtures/sample.pdf`, `sample.docx`, `sample.txt` once per VU via `open(..., 'b')`.
- Each `extract` iteration picks a random file type, builds `FormData` with `Uint8Array`, posts `multipart/form-data` to `POST /extract`, checks `status 200` and `json.text`.
- `health` checks `GET /health` `status 200` and `json.status==ok`.
- Custom metrics `extraction_duration` (`Trend`) and `errors` (`Rate`); thresholds fail build on any error.

## When to Run

- Quick sanity before deploy to verify `p95<1500ms` and `0%` errors.
- `VUS=50-100` spike to catch `extraction_pool` saturation (`busy >= max` + `queue>10`).
- Soak `DURATION=5m` to catch leaks and `extraction_duration_seconds p95>5s`.
- `MODE=rps` for open-model arrival to test `30s` timeout and backpressure.
