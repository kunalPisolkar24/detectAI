import http from 'k6/http';
import { check, sleep } from 'k6';
import { config, thresholds } from './lib/config.js';
import { workerMetrics } from './lib/metrics.js';
import { generateRunId, paymentsUser, paymentsEventFor, generateUUID, pickWeighted } from './lib/data.js';

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

function baseThresholds() {
    return {
        http_req_failed: ['rate<0.01'],
        http_req_duration: [`p(95)<${thresholds.ingestP95}`, `p(99)<${thresholds.ingestP99}`],
        worker_ingest_duration: [`p(95)<${thresholds.ingestP95}`, `p(99)<${thresholds.ingestP99}`],
        worker_ingest_success: [`rate>=${thresholds.successRate}`],
        worker_verify_success: [`rate>=${thresholds.verifyRate}`],
        worker_negative_check: [`rate>=${thresholds.negativeRate}`],
        checks: [`rate>=${thresholds.successRate}`],
    };
}

function buildOptions() {
    const gracefulStop = config.gracefulStop;
    if (config.scenario === 'smoke') {
        return {
            vus: 2,
            duration: '30s',
            gracefulStop,
            thresholds: baseThresholds(),
        };
    }
    if (config.scenario === 'soak') {
        return {
            scenarios: {
                soak: {
                    executor: 'constant-arrival-rate',
                    rate: 5,
                    timeUnit: '1s',
                    duration: config.paymentsDuration || '10m',
                    preAllocatedVUs: Math.min(config.paymentsVUs, 10),
                    maxVUs: 50,
                },
            },
            gracefulStop,
            thresholds: baseThresholds(),
        };
    }
    if (config.scenario === 'stress') {
        const peak = Math.max((config.paymentsRps || 10) * 3, 30);
        return {
            scenarios: {
                stress: {
                    executor: 'ramping-arrival-rate',
                    startRate: 5,
                    timeUnit: '1s',
                    preAllocatedVUs: config.paymentsVUs,
                    maxVUs: Math.min(Math.max(config.paymentsVUs * 4, 50), 200),
                    stages: [
                        { duration: '1m', target: config.paymentsRps || 10 },
                        { duration: '2m', target: peak },
                        { duration: '1m', target: 0 },
                    ],
                },
            },
            gracefulStop,
            thresholds: baseThresholds(),
        };
    }
    return {
        scenarios: {
            constant_request_rate: {
                executor: 'constant-arrival-rate',
                rate: config.paymentsRps,
                timeUnit: '1s',
                duration: config.paymentsDuration,
                preAllocatedVUs: config.paymentsVUs,
                maxVUs: Math.min(Math.max(config.paymentsVUs * 4, 50), 200),
            },
        },
        gracefulStop,
        thresholds: baseThresholds(),
    };
}

export const options = buildOptions();

export function setup() {
    const deadline = Date.now() + 30000;
    let ready = false;
    let mock = false;
    while (Date.now() < deadline) {
        try {
            const r = http.get(`${config.proxyUrl}/ready`);
            if (r.status === 200) {
                ready = true;
                try { mock = !!r.json().mock; } catch (e) { mock = false; }
                break;
            }
        } catch (e) { /* retry */ }
        sleep(1);
    }
    check(ready, { 'setup: proxy ready': (v) => v === true });
    const run = config.runId || generateRunId('pay');
    // Pre-seed the user pool so per-request upserts can be skipped
    // (ensureUser=false isolates worker cost from proxy DB writes).
    try {
        http.post(
            `${config.proxyUrl}/seed-users`,
            JSON.stringify({ run, count: config.poolSize, prefix: 'pay' }),
            JSON_HEADERS,
        );
    } catch (e) { /* seed is best-effort; per-request upsert still works */ }
    return { run, mock };
}

function pollVerify(userId) {
    const start = Date.now();
    const timeout = Math.min(config.verifyTimeoutMs, 5000);
    let found = false;
    while (Date.now() - start < timeout) {
        const t0 = Date.now();
        try {
            const r = http.get(`${config.proxyUrl}/verify/payments?userId=${userId}`);
            workerMetrics.verifyDuration.add(Date.now() - t0);
            if (r.status === 200) {
                try {
                    if (r.json().found === true) { found = true; break; }
                } catch (e) { /* retry */ }
            }
        } catch (e) { /* retry */ }
        sleep(config.verifyPollMs / 1000);
    }
    workerMetrics.verifySuccess.add(found);
    return found;
}

function sendNormal(userId) {
    const eventType = paymentsEventFor(__ITER);
    const t0 = Date.now();
    const res = http.post(
        `${config.proxyUrl}/payments`,
        JSON.stringify({ event_type: eventType, userId, ensureUser: false }),
        JSON_HEADERS,
    );
    workerMetrics.ingestDuration.add(Date.now() - t0);
    const ok = check(res, { 'payments: ingest 200': (r) => r.status === 200 });
    workerMetrics.ingestSuccess.add(ok);
    return ok;
}

function sendDuplicate(userId) {
    const eventId = `dup_${userId}_${__ITER}`;
    const payload = JSON.stringify({
        event_type: 'subscription.updated',
        userId,
        event_id: eventId,
        ensureUser: false,
    });
    const t0 = Date.now();
    const first = http.post(`${config.proxyUrl}/payments`, payload, JSON_HEADERS);
    const second = http.post(`${config.proxyUrl}/payments`, payload, JSON_HEADERS);
    workerMetrics.ingestDuration.add(Date.now() - t0);
    // Ingest accepts both; dedup happens downstream (no 5xx, no 429).
    const ok = check(first, { 'payments: dup first 200': (r) => r.status === 200 })
        && check(second, { 'payments: dup second 200': (r) => r.status === 200 });
    workerMetrics.ingestSuccess.add(ok);
    return ok;
}

function sendInvalid() {
    const res = http.post(
        `${config.proxyUrl}/payments`,
        JSON.stringify({ event_type: 123, userId: '', ensureUser: false }),
        JSON_HEADERS,
    );
    const ok = check(res, { 'payments: invalid rejected 400': (r) => r.status === 400 });
    workerMetrics.negativeCheck.add(ok);
}

export default function (data) {
    const run = (data && data.run) || config.runId || 'local';
    const mock = !!(data && data.mock);
    const userId = paymentsUser(run, __VU, config.poolSize);
    const mode = pickWeighted([[0.9, 'normal'], [0.05, 'dup'], [0.05, 'invalid']]);

    if (mode === 'invalid') {
        sendInvalid();
        return;
    }
    let ok = false;
    if (mode === 'dup') ok = sendDuplicate(userId);
    else ok = sendNormal(userId);

    // 10% sample verifies the worker actually materialized the row.
    // Skipped in MOCK_MODE (proxy never writes, verify would always miss).
    if (ok && !mock && Math.random() < 0.1) {
        const found = pollVerify(userId);
        check(found, { 'payments: worker materialized row': (v) => v === true });
    }

    if (config.scenario === 'smoke') sleep(0.5);
}

export function handleSummary(data) {
    const lines = [
        `payments scenario=${config.scenario} run=${(data.setup_data && data.setup_data.run) || config.runId || 'local'}`,
        `checks=${data.metrics.checks ? data.metrics.checks.values.rate.toFixed(4) : 'n/a'}`,
        `ingest_p95=${data.metrics.worker_ingest_duration ? data.metrics.worker_ingest_duration.values['p(95)'].toFixed(1) : 'n/a'}ms`,
        `http_failed=${data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate.toFixed(4) : 'n/a'}`,
    ];
    return { stdout: lines.join('\n') + '\n' };
}
