import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { pickProfile, buildRequest, secretsFromEnv } from '../lib/payloads.js';
import { readBaseline, readCurrent, checkNoLoss } from '../lib/rabbitmq.js';

// Happy-path smoke: one valid signed webhook per iteration.
//
// The gateway publishes to RabbitMQ synchronously and only answers "queued"
// after the broker acked the message, so a 200 carrying status "queued" is
// already proof the broker took it. The teardown adds the delivery proof the
// configured mode asks for.
//
// The queue depth is logged rather than asserted on its own: against a
// broker with a live consumer the depth says nothing about what was
// delivered, only about what is still sitting there.
export const options = {
    vus: parseInt(__ENV.SMOKE_VUS) || 2,
    iterations: parseInt(__ENV.SMOKE_ITERATIONS) || 2,
    thresholds: {
        checks: ['rate==1.0'],
    },
};

const published = new Counter('load_published_total');
const secrets = secretsFromEnv();

export function setup() {
    return readBaseline(secrets.baseUrl);
}

export default function () {
    const req = buildRequest(pickProfile(0), secrets);

    const res = http.post(`${secrets.baseUrl}${req.url}`, req.body, req.params);

    const ok = check(res, {
        'status is 200': (r) => r.status === 200,
        'status is queued': (r) => r.status === 200 && r.json().status === 'queued',
    });
    if (ok) {
        published.add(1);
    }

    sleep(0.1);
}

export function teardown(baseline) {
    const current = readCurrent(secrets.baseUrl);
    if (baseline.depth != null && current.depth >= 0) {
        console.log(`queue depth grew by ${current.depth - baseline.depth}`);
    }
    checkNoLoss(baseline, current);
}
