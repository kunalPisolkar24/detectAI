import http from 'k6/http';
import { check, sleep } from 'k6';
import { config, thresholds } from './lib/config.js';
import { workerMetrics } from './lib/metrics.js';
import { generateRunId, analyticsUser, analyticsCount, generateUUID, pickWeighted } from './lib/data.js';

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
    // Edge traffic intentionally returns 400s, which k6 counts in
    // http_req_failed: keep it in its own scenario with only negative-rate
    // thresholds so happy-path SLOs stay pure.
    if (config.scenario === 'edge') {
        return {
            vus: 2,
            duration: '1m',
            thresholds: {
                checks: [`rate>=${thresholds.successRate}`],
                worker_negative_check: [`rate>=${thresholds.negativeRate}`],
            },
        };
    }
    if (config.scenario === 'smoke') {
        return { vus: 2, duration: '30s', thresholds: baseThresholds() };
    }
    if (config.scenario === 'soak') {
        return {
            scenarios: {
                soak: {
                    executor: 'constant-arrival-rate',
                    rate: 5,
                    timeUnit: '1s',
                    duration: config.analyticsDuration || '10m',
                    preAllocatedVUs: Math.min(config.analyticsVUs, 10),
                    maxVUs: 50,
                },
            },
            thresholds: baseThresholds(),
        };
    }
    if (config.scenario === 'stress') {
        const peak = Math.max((config.analyticsRps || 20) * 3, 60);
        return {
            scenarios: {
                stress: {
                    executor: 'ramping-arrival-rate',
                    startRate: 5,
                    timeUnit: '1s',
                    preAllocatedVUs: config.analyticsVUs,
                    maxVUs: Math.min(Math.max(config.analyticsVUs * 4, 50), 200),
                    stages: [
                        { duration: '1m', target: config.analyticsRps || 20 },
                        { duration: '2m', target: peak },
                        { duration: '1m', target: 0 },
                    ],
                },
            },
            thresholds: baseThresholds(),
        };
    }
    return {
        scenarios: {
            constant_request_rate: {
                executor: 'constant-arrival-rate',
                rate: config.analyticsRps,
                timeUnit: '1s',
                duration: config.analyticsDuration,
                preAllocatedVUs: config.analyticsVUs,
                maxVUs: Math.min(Math.max(config.analyticsVUs * 4, 50), 200),
            },
        },
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
    const run = config.runId || generateRunId('ana');
    console.log(`analytics setup run=${run} pool=${config.poolSize}`);
    let seeded = false;
    try {
        const r = http.post(
            `${config.proxyUrl}/seed-users`,
            JSON.stringify({ run, count: config.poolSize, prefix: 'ana' }),
            JSON_HEADERS,
        );
        seeded = r.status === 200;
    } catch (e) { seeded = false; }
    return { run, mock, seeded };
}

function pollVerify(userId) {
    const start = Date.now();
    const timeout = Math.min(config.verifyTimeoutMs, 5000);
    let found = false;
    while (Date.now() - start < timeout) {
        const t0 = Date.now();
        try {
            const r = http.get(`${config.proxyUrl}/verify/analytics?userId=${userId}`);
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

function sendNormal(userId, ensureUser) {
    const t0 = Date.now();
    const res = http.post(
        `${config.proxyUrl}/analytics`,
        JSON.stringify({ userId, count: analyticsCount(), ensureUser }),
        JSON_HEADERS,
    );
    workerMetrics.ingestDuration.add(Date.now() - t0);
    const ok = check(res, { 'analytics: ingest 200': (r) => r.status === 200 });
    workerMetrics.ingestSuccess.add(ok);
    return ok;
}

function sendDuplicate(userId, ensureUser) {
    const eventId = generateUUID();
    const payload = JSON.stringify({ userId, count: 1, eventId, ensureUser });
    const t0 = Date.now();
    const first = http.post(`${config.proxyUrl}/analytics`, payload, JSON_HEADERS);
    const second = http.post(`${config.proxyUrl}/analytics`, payload, JSON_HEADERS);
    workerMetrics.ingestDuration.add(Date.now() - t0);
    const ok = check(first, { 'analytics: dup first 200': (r) => r.status === 200 })
        && check(second, { 'analytics: dup second 200': (r) => r.status === 200 });
    workerMetrics.ingestSuccess.add(ok);
    return ok;
}

function sendInvalidBattery() {
    const cases = [
        ['empty userId', JSON.stringify({ userId: '', count: 1 })],
        ['zero count', JSON.stringify({ userId: 'ana_edge_u1', count: 0 })],
        ['negative count', JSON.stringify({ userId: 'ana_edge_u1', count: -5 })],
        ['non-int count', JSON.stringify({ userId: 'ana_edge_u1', count: 1.5 })],
        ['malformed json', '{not-json'],
    ];
    for (const [name, body] of cases) {
        const res = http.post(`${config.proxyUrl}/analytics`, body, JSON_HEADERS);
        const ok = check(res, { [`analytics edge ${name} rejected 400`]: (r) => r.status === 400 });
        workerMetrics.negativeCheck.add(ok);
    }
}

function sendInvalid() {
    sendInvalidBattery();
}

export default function (data) {
    // Edge scenario runs only the invalid battery (see buildOptions).
    if (config.scenario === 'edge') {
        sendInvalidBattery();
        sleep(0.5);
        return;
    }
    const run = (data && data.run) || config.runId || 'local';
    const mock = !!(data && data.mock);
    const ensureUser = !(data && data.seeded);
    // Bounded pool: (VU + ITER) % pool keeps DB size at poolSize instead of
    // unbounded VU*ITER growth.
    const userId = analyticsUser(run, __VU, __ITER, config.poolSize);
    const mode = pickWeighted([[0.95, 'normal'], [0.05, 'dup']]);

    let ok = false;
    if (mode === 'dup') ok = sendDuplicate(userId, ensureUser);
    else ok = sendNormal(userId, ensureUser);

    if (ok && !mock && Math.random() < 0.1) {
        const found = pollVerify(userId);
        check(found, { 'analytics: worker flushed usage': (v) => v === true });
    }

    if (config.scenario === 'smoke') sleep(0.5);
}

export function handleSummary(data) {
    const lines = [
        `analytics scenario=${config.scenario} run=${config.runId || 'local'}`,
        `checks=${data.metrics.checks ? data.metrics.checks.values.rate.toFixed(4) : 'n/a'}`,
        `ingest_p95=${data.metrics.worker_ingest_duration ? data.metrics.worker_ingest_duration.values['p(95)'].toFixed(1) : 'n/a'}ms`,
        `http_failed=${data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate.toFixed(4) : 'n/a'}`,
    ];
    return { stdout: lines.join('\n') + '\n' };
}
