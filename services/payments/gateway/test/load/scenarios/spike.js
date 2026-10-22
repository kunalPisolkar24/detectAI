import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { pickProfile, buildRequest, buildInvalidSignatureRequest, secretsFromEnv } from '../lib/payloads.js';
import { readBaseline, readCurrent, checkNoLoss } from '../lib/rabbitmq.js';

export const options = {
    stages: [
        { duration: __ENV.RAMP_UP || '10s', target: parseInt(__ENV.TARGET_VUS) || 20 },
        { duration: __ENV.DURATION || '30s', target: parseInt(__ENV.TARGET_VUS) || 200 },
        { duration: __ENV.RAMP_DOWN || '10s', target: 0 },
    ],
    thresholds: {
        // ~5% of traffic is intentional invalid-signature noise (expects 401),
        // so the failure budget covers 1% unexpected on top of that.
        http_req_failed: ['rate<0.06'],
        http_req_duration: ['p(95)<500'],
        checks: ['rate==1.0'],
    },
};

const published = new Counter('load_published_total');
const secrets = secretsFromEnv();

let iter = 0;

export function setup() {
    return readBaseline(secrets.baseUrl);
}

export default function () {
    const req = iter % 20 === 19 ? buildInvalidSignatureRequest(secrets) : buildRequest(pickProfile(iter), secrets);
    iter += 1;

    const res = http.post(`${secrets.baseUrl}${req.url}`, req.body, req.params);

    const ok = check(res, {
        'expected status': (r) => r.status === req.expect,
        'queued body': (r) => req.expect !== 200 || r.json().status === 'queued',
    });
    if (ok && req.expect === 200) {
        published.add(1);
    }

    sleep(0.1); // 100ms between requests per VU
}

export function teardown(baseline) {
    checkNoLoss(baseline, readCurrent(secrets.baseUrl));
}
