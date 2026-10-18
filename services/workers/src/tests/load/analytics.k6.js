import http from 'k6/http';
import { check, sleep } from 'k6';
import { config } from './lib/config.js';
import { workerMetrics } from './lib/metrics.js';
import { buildOptions } from './lib/scenarios.js';
import { generateRunId, analyticsUser, analyticsCount, generateUUID, verifyUser, pickWeighted } from './lib/data.js';
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
// In-network URL under compose.load-analytics.yml; host runs hit the mapped port.
const WORKER_METRICS_URL = config.workerMetricsUrl || 'http://localhost:7001/metrics';
const QUEUE = 'analytics.usage';

export const options = buildOptions({
    vus: config.analyticsVUs,
    duration: config.analyticsDuration,
    rps: config.analyticsRps,
    peakFloor: 60,
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
    const run = config.runId || generateRunId('ana');
    console.log(`analytics setup run=${run} pool=${config.poolSize}`);
    let seeded = false;
    try {
        const r = http.post(
            `${config.proxyUrl}/seed-users`,
            JSON.stringify({ run, count: config.poolSize, prefix: 'ana' }),
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

function postAnalytics(payload, checkName) {
    const t0 = Date.now();
    const res = http.post(`${config.proxyUrl}/analytics`, JSON.stringify(payload), INGEST_PARAMS);
    workerMetrics.ingestDuration.add(Date.now() - t0);
    const ok = check(res, { [checkName]: (r) => r.status === 200 });
    workerMetrics.ingestSuccess.add(ok);
    return ok;
}

// Pool user: exercises counter contention and pool reuse.
function sendNormal(userId, ensureUser) {
    return postAnalytics({
        userId,
        count: analyticsCount(),
        ensureUser,
    }, 'analytics: ingest 200');
}

// Same event id twice: the worker must claim once and drop the second copy.
// Ingest accepts both; the dedup itself is asserted from the worker's stale
// events counter in teardown.
function sendDuplicate(userId, ensureUser) {
    const eventId = generateUUID();
    const payload = { userId, count: 1, eventId, ensureUser };
    const first = postAnalytics(payload, 'analytics: dup first 200');
    const second = postAnalytics(payload, 'analytics: dup second 200');
    return first && second;
}

// Single-use user + unique event id: the exact-count assertion below can only
// be satisfied by this event, so a lost publish, a stalled worker or a broken
// flush fails the run instead of passing on an older row.
function sendVerified(run) {
    const userId = verifyUser('ana', run, __VU, __ITER);
    const count = analyticsCount();
    const ingested = postAnalytics({
        userId,
        count,
        eventId: generateUUID(),
        ensureUser: true,
    }, 'analytics: verified ingest 200');
    if (!ingested) return false;
    const { verified } = pollVerify(
        `${config.proxyUrl}/verify/analytics?userId=${userId}`,
        (body) => body.found === true && body.total === count,
    );
    return check(verified, { 'analytics: worker flushed exact usage count': (v) => v === true });
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
        const res = http.post(`${config.proxyUrl}/analytics`, body, EDGE_PARAMS);
        const ok = check(res, { [`analytics edge ${name} rejected 400`]: (r) => r.status === 400 });
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
        const userId = analyticsUser(run, __VU, __ITER, config.poolSize);
        const mode = pickWeighted([[1 - config.dupWeight, 'normal'], [config.dupWeight, 'dup']]);
        if (mode === 'dup') sendDuplicate(userId, ensureUser);
        else sendNormal(userId, ensureUser);
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
        (s) => seriesValue(s, 'worker_jobs_processed_total') + seriesValue(s, 'worker_cron_stale_events_filtered_total', { reason: 'duplicate' }),
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
    assertSeries(series, 'worker requeued nothing for infra faults', 'worker_infra_requeued_total', { exact: 0 });
    // DUP_WEIGHT sends same-event-id pairs; exactly one of each pair must lose.
    // Analytics dedup surfaces under the cron-prefixed stale-events counter
    // (shared MetricsService; see the rename follow-up in the README).
    // Edge sends no duplicates at all, so the path only applies elsewhere.
    if (config.scenario !== 'edge') {
        assertSeries(series, 'dedup path exercised', 'worker_cron_stale_events_filtered_total', { labels: { reason: 'duplicate' }, min: 1 });
    }
}

export function handleSummary(data) {
    return printSummary([
        `analytics scenario=${config.scenario} run=${config.runId || 'local'}`,
        `checks=${metricRate(data, 'checks')}`,
        `ingest_p95=${metricP(data, 'worker_ingest_duration', 95)}ms`,
        `http_failed=${metricRate(data, 'http_req_failed')}`,
        `verify_samples=${metricCount(data, 'worker_verify_samples')}`,
        `verify_rate=${metricRate(data, 'worker_verify_success')}`,
        `worker_health=${metricRate(data, 'worker_health_check')}`,
        `dropped_iterations=${metricCount(data, 'dropped_iterations')}`,
    ]);
}