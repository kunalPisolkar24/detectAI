import http from 'k6/http';
import { check } from 'k6';
import { config, thresholds } from './lib/config.js';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        http_req_failed: ['rate<0.01'],
        checks: [`rate>=${thresholds.successRate}`],
    },
};

export default function () {
    const url = `${config.proxyUrl}/cron/seed`;
    const payload = JSON.stringify({
        count: config.seedCount,
    });

    const params = {
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const res = http.post(url, payload, params);
    check(res, {
        'status is 200': (r) => r.status === 200,
        'seeded correct amount': (r) => r.json().count === config.seedCount,
    });
}
