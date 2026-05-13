import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    scenarios: {
        constant_request_rate: {
            executor: 'constant-arrival-rate',
            rate: __ENV.RPS || 10,
            timeUnit: '1s',
            duration: __ENV.DURATION || '30s',
            preAllocatedVUs: 10,
            maxVUs: 100,
        },
    },
};

export default function () {
    const url = 'http://localhost:9999/payments';
    const payload = JSON.stringify({
        event_type: 'subscription.updated',
        userId: `user_k6_${__VU}_${__ITER}`,
    });

    const params = {
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const res = http.post(url, payload, params);
    check(res, {
        'status is 200': (r) => r.status === 200,
    });
    
    // Adjust sleep to maintain RPS if needed, but stages handles it in k6
    // If using constant RPS, k6 arrival-rate executors are better.
}
