import http from 'k6/http';
import { check, sleep } from 'k6';
import { generatePaddleSignature } from '../utils.js';

export const options = {
    stages: [
        { duration: __ENV.RAMP_UP || '10s', target: parseInt(__ENV.TARGET_VUS) || 20 },
        { duration: __ENV.DURATION || '30s', target: parseInt(__ENV.TARGET_VUS) || 200 },
        { duration: __ENV.RAMP_DOWN || '10s', target: 0 },
    ],
    thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<500'],
    },
};

const WEBHOOK_SECRET = __ENV.PADDLE_WEBHOOK_SECRET || 'test_secret';
const INTERNAL_KEY = __ENV.INTERNAL_API_KEY || 'test_internal_key';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
    // 50/50 split between webhooks and internal events
    if (Math.random() > 0.5) {
        const payload = JSON.stringify({ event_type: 'subscription.updated' });
        const signature = generatePaddleSignature(payload, WEBHOOK_SECRET);
        const res = http.post(`${BASE_URL}/webhook/paddle`, payload, {
            headers: { 'Content-Type': 'application/json', 'Paddle-Signature': signature }
        });
        check(res, { 'webhook ok': (r) => r.status === 200 });
    } else {
        const payload = JSON.stringify({ event_type: 'user.cancel_subscription' });
        const res = http.post(`${BASE_URL}/internal/events`, payload, {
            headers: { 'Content-Type': 'application/json', 'X-Internal-Key': INTERNAL_KEY }
        });
        check(res, { 'internal ok': (r) => r.status === 200 });
    }

    sleep(0.5);
}
