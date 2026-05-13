import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    scenarios: {
        constant_request_rate: {
            executor: 'constant-arrival-rate',
            rate: __ENV.RPS || 20,
            timeUnit: '1s',
            duration: __ENV.DURATION || '30s',
            preAllocatedVUs: 10,
            maxVUs: 100,
        },
    },
};

export default function () {
    const url = 'http://localhost:9999/analytics';
    const payload = JSON.stringify({
        userId: `user_k6_${__VU}_${__ITER}`,
        count: Math.floor(Math.random() * 10) + 1,
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
}
