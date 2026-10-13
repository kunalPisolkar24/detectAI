import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { generatePaddleSignature } from '../utils.js';
import { errorTotal } from '../lib/runtime.js';

// Orchestrated failure injection. Run ONLY via `make load-test-chaos`, which
// stops RabbitMQ mid-run and restarts it: requests during the outage must
// fast-fail 503 with a Retry-After header, and traffic must recover after.
// 503s are correct behavior here, so http_req_failed is not gated; the
// checks rate plus the teardown fast-fail proof gate the run.
export const options = {
    stages: [
        { duration: '30s', target: 20 },
        { duration: '3m', target: 20 },
        { duration: '30s', target: 0 },
    ],
    thresholds: {
        checks: ['rate>0.99'],
        http_req_duration: ['p(95)<1000'],
    },
};

const chaos503 = new Counter('chaos_503_total');

const WEBHOOK_SECRET = __ENV.PADDLE_WEBHOOK_SECRET || 'test_secret';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export function setup() {
    return { e503: errorTotal(BASE_URL, '503') };
}

export default function () {
    const payload = JSON.stringify({
        event_type: 'subscription.updated',
        data: { id: 'sub_123', status: 'active' },
    });
    const res = http.post(`${BASE_URL}/webhook/paddle`, payload, {
        headers: {
            'Content-Type': 'application/json',
            'Paddle-Signature': generatePaddleSignature(payload, WEBHOOK_SECRET),
        },
    });

    if (res.status === 503) {
        chaos503.add(1);
        check(res, {
            'fast-fail has retry-after': (r) => r.headers['Retry-After'] === '5',
        });
    } else {
        check(res, {
            'status is 200': (r) => r.status === 200,
            'status is queued': (r) => r.json().status === 'queued',
        });
    }

    sleep(0.2);
}

export function teardown(baseline) {
    // Proves the outage was actually injected: a green run without any new
    // 503 is an orchestration failure, not resilience. Broker-side 503
    // counter avoids k6 VU state, which teardown cannot see.
    const current = errorTotal(BASE_URL, '503');
    if (baseline.e503 == null || current == null) {
        check(null, { '503 counter readable': () => false });
        return;
    }
    const growth = current - baseline.e503;
    check(null, { [`fast-fail observed during outage (${growth} new 503s)`]: () => growth > 0 });
}
