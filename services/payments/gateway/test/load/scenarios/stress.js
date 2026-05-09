import http from 'k6/http';
import { check, sleep } from 'k6';
import { generatePaddleSignature } from '../utils.js';

export const options = {
    stages: [
        { duration: __ENV.RAMP_UP || '1m', target: parseInt(__ENV.VUS_LOW) || 50 },
        { duration: __ENV.RAMP_MED || '2m', target: parseInt(__ENV.VUS_MED) || 100 },
        { duration: __ENV.RAMP_HIGH || '2m', target: parseInt(__ENV.VUS_HIGH) || 200 },
        { duration: __ENV.RAMP_MAX || '2m', target: parseInt(__ENV.VUS_MAX) || 300 },
        { duration: __ENV.RAMP_DOWN || '1m', target: 0 },
    ],
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(99)<1000'],
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
