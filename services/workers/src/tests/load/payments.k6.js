import http from 'k6/http';
import { check, sleep } from 'k6';
import { config } from './lib/config.js';
import { workerMetrics } from './lib/metrics.js';
import { buildOptions } from './lib/scenarios.js';
import { generateRunId, paymentsUser, paymentsEventFor, verifyUser, pickWeighted } from './lib/data.js';
import { pollVerify } from './lib/verify.js';
import { metricCount, metricP, metricRate, printSummary } from './lib/summary.js';
import {
    assertQueueDrained,
    assertQueueEmpty,
    assertSeries,
    processStartTime,
    publishedCounts,
    recordHealth,
    seriesValue,
    waitForAccounted,
} from './lib/workerSignals.js';

// Request phases. Only ingest and verify carry SLOs, so setup probes, the edge
// battery and teardown scrapes must not share a tag with them.
const SETUP_PARAMS = { headers: { 'Content-Type': 'application/json' }, tags: { phase: 'setup' } };
const INGEST_PARAMS = { headers: { 'Content-Type': 'application/json' }, tags: { phase: 'ingest' } };
const EDGE_PARAMS = { headers: { 'Content-Type': 'application/json' }, tags: { phase: 'edge' } };
// In-network URL under compose.load-payments.yml; host runs hit the mapped port.
const WORKER_METRICS_URL = config.workerMetricsUrl || 'http://localhost:7003/metrics';
const QUEUE = 'payment_events';

export const options = buildOptions({
    vus: config.paymentsVUs,
    duration: config.paymentsDuration,
    rps: config.paymentsRps,
    peakFloor: 30,
});

export function setup() {
    const deadline = Date.now() + 30000;
    let ready = false;
    let mock = false;
    while (Date.now() < deadline) {
        try {
            const r = http.get(`${config.proxyUrl}/ready`, SETUP_PARAMS);
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
    // Pool slots shared across VUs lose their guaranteed per-user event order.
    console.log(`payments setup run=${run} pool=${config.poolSize} vus=${config.paymentsVUs}`);
    // Pre-seed the user pool so per-request upserts can be skipped
    // (ensureUser=false isolates worker cost from proxy DB writes).
    // If seeding fails the run still works: requests fall back to ensureUser=true.
    let seeded = false;
    try {
        const r = http.post(
            `${config.proxyUrl}/seed-users`,
            JSON.stringify({ run, count: config.poolSize, prefix: 'pay' }),
            SETUP_PARAMS,
        );
        seeded = r.status === 200;
    } catch (e) { seeded = false; }
    // Boot time of the worker under test; teardown fails the run if it changed,
    // because a restart silently zeroes every in-process counter.
    const startedAt = mock ? null : processStartTime(WORKER_METRICS_URL);
    if (!mock) recordHealth('worker boot time observed', startedAt !== null, `${WORKER_METRICS_URL}=${startedAt}`);
    return { run, mock, seeded, startedAt };
}

function postPayments(payload, checkName) {
    const t0 = Date.now();
    const res = http.post(`${config.proxyUrl}/payments`, JSON.stringify(payload), INGEST_PARAMS);
    workerMetrics.ingestDuration.add(Date.now() - t0);
    const ok = check(res, { [checkName]: (r) => r.status === 200 });
    workerMetrics.ingestSuccess.add(ok);
    return ok;
}

// Pool user: exercises lifecycle transitions and pool contention.
function sendNormal(userId, ensureUser, sharedSlots) {
    return postPayments({
        event_type: paymentsEventFor(__ITER, sharedSlots),
        userId,
        ensureUser,
    }, 'payments: ingest 200');
}

// Same event id twice: the worker must claim once and drop the second copy.
// Ingest accepts both; the dedup itself is asserted from the worker's
// duplicate counter in teardown.
function sendDuplicate(userId, ensureUser) {
    const eventId = `dup_${userId}_${__ITER}`;
    const first = postPayments({
        event_type: 'subscription.updated',
        userId,
        event_id: eventId,
        ensureUser,
    }, 'payments: dup first 200');
    const second = postPayments({
        event_type: 'subscription.updated',
        userId,
        event_id: eventId,
        ensureUser,
    }, 'payments: dup second 200');
    return first && second;
}

// Single-use user + created event: `found && status === ACTIVE` can only be
// produced by the event just published, so a lost publish, a stalled worker or
// a broken handler fails the run instead of passing on an older row.
function sendVerified(run) {
    const userId = verifyUser('pay', run, __VU, __ITER);
    const ingested = postPayments({
        event_type: 'subscription.created',
        userId,
        ensureUser: true,
    }, 'payments: verified ingest 200');
    if (!ingested) return false;
    const { verified } = pollVerify(
        `${config.proxyUrl}/verify/payments?userId=${userId}`,
        (body) => body.found === true && body.status === 'ACTIVE',
    );
    return check(verified, { 'payments: worker materialized ACTIVE subscription': (v) => v === true });
}

function sendInvalidBattery() {
    const cases = [
        ['wrong-type event_type', JSON.stringify({ event_type: 123, userId: 'pay_edge_u1' })],
        ['empty userId', JSON.stringify({ event_type: 'subscription.updated', userId: '' })],
        ['oversized userId', JSON.stringify({ event_type: 'subscription.updated', userId: 'u'.repeat(100) })],
        ['malformed json', '{not-json'],
    ];
    for (const [name, body] of cases) {
        const res = http.post(`${config.proxyUrl}/payments`, body, EDGE_PARAMS);
        const ok = check(res, { [`payments edge ${name} rejected 400`]: (r) => r.status === 400 });
        workerMetrics.negativeCheck.add(ok);
    }
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

    // Verification replaces the iteration's pool traffic so the arrival rate
    // stays exactly what the executor promises.
    if (!mock && Math.random() < config.verifySampleRate) {
        sendVerified(run);
    } else {
        const userId = paymentsUser(run, __VU, config.poolSize);
        const mode = pickWeighted([[1 - config.dupWeight, 'normal'], [config.dupWeight, 'dup']]);
        if (mode === 'dup') sendDuplicate(userId, ensureUser);
        else sendNormal(userId, ensureUser, config.poolSize < config.paymentsVUs);
    }

    if (config.scenario === 'smoke') sleep(0.5);
}

// Runs after k6 stops sending traffic. Waits for the queues to drain, then
// asserts the worker's own counters: a run where every request returned 200 but
// the worker errored, dropped or dead-lettered work must fail here, which
// proxy-side checks alone cannot detect.
export function teardown(data) {
    workerMetrics.teardownRuns.add(1);
    if (data && data.mock) {
        console.log('teardown: mock proxy, skipping worker signal assertions');
        return;
    }

    assertQueueDrained(QUEUE);
    assertQueueDrained(`${QUEUE}_retry`);
    assertQueueEmpty(`${QUEUE}_dlq`);

    const published = publishedCounts();
    if (!published) return recordHealth('proxy /stats reachable', false, `${config.proxyUrl}/stats`);
    const publishedCount = published[QUEUE] || 0;
    recordHealth('proxy /stats reachable', true, `${QUEUE} published=${publishedCount}`);

    if (data && typeof data.startedAt === 'number') {
        const startedAt = processStartTime(WORKER_METRICS_URL);
        recordHealth('worker did not restart', startedAt === data.startedAt,
            `start_time=${startedAt} setup_start_time=${data.startedAt}`);
    }

    // Every event the broker confirmed must come back as a processed job or a
    // deduplicated one. This is the assertion that catches a worker which
    // silently discards work: every other gate is satisfied by a queue that
    // simply emptied into the void.
    const { series, accounted } = waitForAccounted(
        WORKER_METRICS_URL,
        publishedCount,
        (s) => seriesValue(s, 'worker_jobs_processed_total') + seriesValue(s, 'worker_duplicate_events_total'),
    );
    if (!series) return recordHealth('worker /metrics reachable', false, WORKER_METRICS_URL);
    recordHealth('worker /metrics reachable', true, WORKER_METRICS_URL);

    if (config.scenario !== 'edge') {
        // Tripwire: an all-zero published count would make the reconciliation
        // above pass without comparing anything.
        recordHealth('proxy published events', publishedCount >= 1, `published=${publishedCount}`);
        recordHealth('published events accounted for', accounted >= publishedCount,
            `processed+deduped=${accounted} published=${publishedCount}`);
    }

    assertSeries(series, 'worker had no job errors', 'worker_job_errors_total', { exact: 0 });
    assertSeries(series, 'worker dead-lettered nothing', 'worker_dead_lettered_total', { exact: 0 });
    assertSeries(series, 'worker had no unhandled events', 'worker_unhandled_events_total', { labels: { event_type: 'other' }, exact: 0 });
    assertSeries(series, 'worker requeued nothing for infra faults', 'worker_infra_requeued_total', { exact: 0 });
    // DUP_WEIGHT sends same-event-id pairs; exactly one of each pair must lose.
    // Edge sends no duplicates at all, so the path only applies elsewhere.
    if (config.scenario !== 'edge') {
        assertSeries(series, 'dedup path exercised', 'worker_duplicate_events_total', { labels: { event_type: 'subscription.updated' }, min: 1 });
    }
}

export function handleSummary(data) {
    return printSummary([
        `payments scenario=${config.scenario} run=${config.runId || 'local'}`,
        `checks=${metricRate(data, 'checks')}`,
        `ingest_p95=${metricP(data, 'worker_ingest_duration', 95)}ms`,
        `http_failed=${metricRate(data, 'http_req_failed')}`,
        `verify_samples=${metricCount(data, 'worker_verify_samples')}`,
        `verify_rate=${metricRate(data, 'worker_verify_success')}`,
        `worker_health=${metricRate(data, 'worker_health_check')}`,
        `dropped_iterations=${metricCount(data, 'dropped_iterations')}`,
    ]);
}