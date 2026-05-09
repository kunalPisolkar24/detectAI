import http from 'k6/http';
import { check, sleep } from 'k6';
import { generatePaddleSignature } from '../utils.js';

export const options = {
    stages: [
        { duration: '1m', target: 50 },  // Normal load
        { duration: '2m', target: 100 }, // Heavy load
        { duration: '2m', target: 200 }, // Stress
        { duration: '2m', target: 300 }, // Breaking point?
        { duration: '1m', target: 0 },   // Scale down
    ],
    thresholds: {
        http_req_failed: ['rate<0.05'],   // Less than 5% errors
        http_req_duration: ['p(99)<1000'], // 99% of requests should be below 1s
    },
};

const WEBHOOK_SECRET = __ENV.PADDLE_WEBHOOK_SECRET || 'test_secret';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
    const payload = JSON.stringify({
        event_type: 'subscription.created',
        data: {
            customer_id: 'cust_456',
            plan_id: 'plan_premium',
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
    });

    sleep(0.05); // 50ms between requests per VU
}
