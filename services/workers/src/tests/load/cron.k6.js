import http from 'k6/http';
import { check } from 'k6';

export const options = {
    vus: 1,
    iterations: 1,
};

export default function () {
    const url = 'http://localhost:9999/cron/seed';
    const payload = JSON.stringify({
        count: __ENV.SEED_COUNT || 1000,
    });

    const params = {
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const res = http.post(url, payload, params);
    check(res, {
        'status is 200': (r) => r.status === 200,
        'seeded correct amount': (r) => r.json().count === (__ENV.SEED_COUNT || 1000),
    });
}
