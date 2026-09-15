import http from 'k6/http';
import { check } from 'k6';
import { config, thresholds } from './lib/config.js';

export const options = {
    scenarios: {
        constant_request_rate: {
            executor: 'constant-arrival-rate',
            rate: config.analyticsRps,
            timeUnit: '1s',
            duration: config.analyticsDuration,
            preAllocatedVUs: config.analyticsVUs,
            maxVUs: Math.max(config.analyticsVUs * 10, 100),
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.01'],
        checks: [`rate>=${thresholds.successRate}`],
    },
};

export default function () {
    const url = `${config.proxyUrl}/analytics`;
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
