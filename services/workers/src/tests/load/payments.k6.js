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
    const eventTypes = [
        'subscription.created',
        'subscription.updated',
        'subscription.canceled',
        'subscription.activated'
    ];
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];

    const url = 'http://localhost:9999/payments';
    const payload = JSON.stringify({
        event_type: eventType,
        userId: `user_k6_${Math.floor(Math.random() * 10000)}`,
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
