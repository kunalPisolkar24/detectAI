import http from 'k6/http';
import { check, sleep } from 'k6';
import { generatePaddleSignature } from '../utils.js';

export const options = {
    stages: [
        { duration: '10s', target: 20 },  // Ramp up
        { duration: '30s', target: 200 }, // Spike
        { duration: '10s', target: 0 },   // Ramp down
    ],
    thresholds: {
        http_req_failed: ['rate<0.01'],   // Less than 1% errors
        http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
    },
};

const WEBHOOK_SECRET = __ENV.PADDLE_WEBHOOK_SECRET || 'test_secret';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
    const payload = JSON.stringify({
        event_type: 'subscription.updated',
        data: {
            id: 'sub_123',
            status: 'active',
        },
    });

    const signature = generatePaddleSignature(payload, WEBHOOK_SECRET);

    const params = {
        headers: {
            'Content-Type': 'application/json',
            'Paddle-Signature': signature,
        },
    };

    const res = http.post(`${BASE_URL}/webhook/paddle`, payload, params);

    check(res, {
        'status is 200': (r) => r.status === 200,
        'status is queued': (r) => r.json().status === 'queued',
    });

    sleep(0.1); // 100ms between requests per VU
}
