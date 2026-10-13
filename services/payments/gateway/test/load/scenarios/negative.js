import http from 'k6/http';
import { check, sleep } from 'k6';
import { generatePaddleSignature } from '../utils.js';

// Rejection-path coverage: every case asserts the exact expected status so
// auth, validation, and tolerance behavior stay locked under load.
// All 4xx here are correct rejections, so http_req_failed is not gated;
// the checks rate is (must be 100%).
export const options = {
    vus: 5,
    iterations: 70,
    thresholds: {
        checks: ['rate==1.0'],
    },
};

const WEBHOOK_SECRET = __ENV.PADDLE_WEBHOOK_SECRET || 'test_secret';
const INTERNAL_KEY = __ENV.INTERNAL_API_KEY || 'test_internal_key';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

let caseIndex = 0;

function post(path, body, headers) {
    return http.post(`${BASE_URL}${path}`, body, { headers: headers });
}

const CASES = [
    {
        name: 'tampered signature rejected',
        run: () => {
            const payload = JSON.stringify({ event_type: 'subscription.updated', data: { id: 'sub_123' } });
            // Flip the last hex digit: appending garbage would be ignored by
            // the validator's h1=([a-f0-9]+) match, so mutate inside the hash.
            const valid = generatePaddleSignature(payload, WEBHOOK_SECRET);
            const tampered = valid.slice(0, -1) + (valid.endsWith('0') ? '1' : '0');
            const res = post('/webhook/paddle', payload, {
                'Content-Type': 'application/json',
                'Paddle-Signature': tampered,
            });
            return check(res, {
                'tampered signature is 401': (r) => r.status === 401,
                'tampered signature body': (r) => r.json().error === 'Invalid signature',
            });
        },
    },
    {
        name: 'missing signature rejected',
        run: () => {
            const payload = JSON.stringify({ event_type: 'subscription.updated', data: { id: 'sub_123' } });
            const res = post('/webhook/paddle', payload, { 'Content-Type': 'application/json' });
            return check(res, { 'missing signature is 401': (r) => r.status === 401 });
        },
    },
    {
        name: 'wrong internal key rejected',
        run: () => {
            const res = post('/internal/events', JSON.stringify({ event_type: 'user.cancel_subscription' }), {
                'Content-Type': 'application/json',
                'X-Internal-Key': 'wrong_key_12345678',
            });
            return check(res, { 'wrong internal key is 401': (r) => r.status === 401 });
        },
    },
    {
        name: 'missing internal key rejected',
        run: () => {
            const res = post('/internal/events', JSON.stringify({ event_type: 'user.cancel_subscription' }), {
                'Content-Type': 'application/json',
            });
            return check(res, { 'missing internal key is 401': (r) => r.status === 401 });
        },
    },
    {
        name: 'oversized body rejected',
        run: () => {
            const payload = JSON.stringify({ event_type: 'subscription.updated', pad: 'x'.repeat(1100000) });
            const res = post('/webhook/paddle', payload, {
                'Content-Type': 'application/json',
                'Paddle-Signature': generatePaddleSignature(payload, WEBHOOK_SECRET),
            });
            return check(res, { 'oversized body is 400': (r) => r.status === 400 });
        },
    },
    {
        name: 'unknown event type accepted',
        run: () => {
            const payload = JSON.stringify({ event_type: 'something.brand_new' });
            const res = post('/webhook/paddle', payload, {
                'Content-Type': 'application/json',
                'Paddle-Signature': generatePaddleSignature(payload, WEBHOOK_SECRET),
            });
            return check(res, {
                'unknown event type is 200': (r) => r.status === 200,
                'unknown event type queued': (r) => r.json().status === 'queued',
            });
        },
    },
    {
        name: 'malformed json accepted as unknown',
        run: () => {
            const payload = '{not valid json';
            const res = post('/webhook/paddle', payload, {
                'Content-Type': 'application/json',
                'Paddle-Signature': generatePaddleSignature(payload, WEBHOOK_SECRET),
            });
            return check(res, { 'malformed json is 200': (r) => r.status === 200 });
        },
    },
];

export default function () {
    // Per-VU round-robin: each VU cycles all cases in order, so every run
    // covers the full set reproducibly without named-scenario metadata.
    const idx = caseIndex++ % CASES.length;
    CASES[idx].run();
    sleep(0.1);
}
