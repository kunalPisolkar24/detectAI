import http from 'k6/http';
import { check } from 'k6';
import { config, thresholds } from './lib/config.js';

export const options = {
    scenarios: {
        constant_request_rate: {
            executor: 'constant-arrival-rate',
            rate: config.paymentsRps,
            timeUnit: '1s',
            duration: config.paymentsDuration,
            preAllocatedVUs: config.paymentsVUs,
            maxVUs: Math.max(config.paymentsVUs * 10, 100),
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.01'],
        checks: [`rate>=${thresholds.successRate}`],
    },
};

export default function () {
    // Stable user per VU slot + created-first: repeats hit the same
    // subscription row through valid transitions (created -> updated* ->
    // canceled -> created ...) instead of poison-transition DLQs.
    const userId = `user_k6_${__VU}`;
    let eventType;
    if (__ITER === 0) {
        eventType = 'subscription.created';
    } else {
        const eventTypes = [
            'subscription.updated',
            'subscription.updated',
            'subscription.activated',
            'subscription.canceled'
        ];
        eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    }

    const url = `${config.proxyUrl}/payments`;
    const payload = JSON.stringify({
        event_type: eventType,
        userId,
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
