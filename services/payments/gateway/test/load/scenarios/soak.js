import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { pickProfile, buildRequest, buildInvalidSignatureRequest, secretsFromEnv } from '../lib/payloads.js';
import { readBaseline, queueDepth, checkNoLoss } from '../lib/rabbitmq.js';
import { sampleRuntime, checkRuntimeStable, publishedSuccessTotal } from '../lib/runtime.js';

export const options = {
    stages: [
        { duration: __ENV.RAMP_UP || '10s', target: parseInt(__ENV.TARGET_VUS) || 20 },
        { duration: __ENV.DURATION || '30s', target: parseInt(__ENV.TARGET_VUS) || 200 },
        { duration: __ENV.RAMP_DOWN || '10s', target: 0 },
    ],
    thresholds: {
        // ~5% intentional invalid-signature noise on top of a 1% budget.
        http_req_failed: ['rate<0.06'],
        http_req_duration: ['p(95)<500'],
        checks: ['rate==1.0'],
    },
};

const published = new Counter('load_published_total');
const secrets = secretsFromEnv();

let iter = 0;

export function setup() {
    return {
        queue: readBaseline(),
        published: publishedSuccessTotal(secrets.baseUrl),
        runtime: sampleRuntime(secrets.baseUrl),
    };
}

export default function () {
    // Deterministic mix of webhook sizes, internal events, and 5% noise.
    // Per-VU round-robin (no named-scenario metadata needed).
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

    sleep(0.5);
}

export function teardown(baseline) {
    checkNoLoss(baseline, { depth: queueDepth(), published: publishedSuccessTotal(secrets.baseUrl) });
    for (const assertion of checkRuntimeStable(baseline.runtime, sampleRuntime(secrets.baseUrl))) {
        check(null, { [assertion.name]: () => assertion.ok });
    }
}
