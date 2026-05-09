import http from 'k6/http';
import { check, sleep } from 'k6';
import { generatePaddleSignature } from '../utils.js';

export const options = {
    stages: [
        { duration: '2m', target: 50 },  // Ramp up
        { duration: '10m', target: 50 }, // Soak for 10 mins
        { duration: '2m', target: 0 },   // Ramp down
    ],
    thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<200'],
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
