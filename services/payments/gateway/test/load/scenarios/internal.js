import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: __ENV.RAMP_UP || '10s', target: parseInt(__ENV.TARGET_VUS) || 20 },
        { duration: __ENV.DURATION || '30s', target: parseInt(__ENV.TARGET_VUS) || 200 },
        { duration: __ENV.RAMP_DOWN || '10s', target: 0 },
    ],
    thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<300'],
    },
};

const INTERNAL_API_KEY = __ENV.INTERNAL_API_KEY || 'test_internal_key';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
    const payload = JSON.stringify({
        event_type: 'user.cancel_subscription',
        data: {
            userId: 'user-123',
            paddleSubscriptionId: 'sub_456',
        },
    });

    const params = {
        headers: {
            'Content-Type': 'application/json',
            'X-Internal-Key': INTERNAL_API_KEY,
        },
    };

    const res = http.post(`${BASE_URL}/internal/events`, payload, params);

    check(res, {
        'status is 200': (r) => r.status === 200,
        'status is queued': (r) => r.json().status === 'queued',
    });

    sleep(0.1); // 100ms between requests per VU
}
