import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '30s', target: __ENV.RPS || 100 }, // ramp up
        { duration: '1m', target: __ENV.RPS || 100 },  // stay
        { duration: '30s', target: 0 },                // ramp down
    ],
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
