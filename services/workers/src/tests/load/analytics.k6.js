import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '30s', target: __ENV.RPS || 200 },
        { duration: '1m', target: __ENV.RPS || 200 },
        { duration: '30s', target: 0 },
    ],
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
