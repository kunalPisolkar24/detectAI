import http from 'k6/http';
import { check, sleep } from 'k6';
import { config, thresholds } from './lib/config.js';
import { workerMetrics } from './lib/metrics.js';
import { generateRunId } from './lib/data.js';
import { metricP, metricRate, metricValue, printSummary } from './lib/summary.js';
import { assertSeries, fetchWorkerSeries, processStartTime, recordHealth, seriesValue, waitForWorkerSignal } from './lib/workerSignals.js';

// The drain loop retries /verify/cron on purpose, so those reads are excluded
// from http_req_* SLOs; only the seed call is a request that must succeed once.
const SEED_PARAMS = { headers: { 'Content-Type': 'application/json' }, tags: { phase: 'seed' } };
const DRAIN_PARAMS = { tags: { phase: 'drain' } };
// In-network URL under compose.load-cron.yml; host runs hit the mapped port.
const WORKER_METRICS_URL = config.workerMetricsUrl || 'http://localhost:7002/metrics';

export function setup() {
    // Boot time of the worker under test; teardown fails the run if it changed,
    // because a restart silently zeroes every in-process counter.
    const startedAt = processStartTime(WORKER_METRICS_URL);
    recordHealth('worker boot time observed', startedAt !== null, `${WORKER_METRICS_URL}=${startedAt}`);
    return { startedAt };
}

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        'http_req_failed{phase:seed}': ['rate<0.01'],
        'http_req_duration{phase:seed}': [`p(95)<${thresholds.seedP95}`],
        worker_seed_duration: [`p(95)<${thresholds.seedP95}`],
        // One sample: how long the sweeper took to clear the seeded backlog.
        // The rig is a drain check, so this is the number that matters.
        worker_drain_duration: [`p(95)<${thresholds.drainP95}`],
        checks: [`rate>=${thresholds.successRate}`],
        // Single sample: `drained` below. Paired with the check so the metric is
        // not recorded without anything reading it.
        worker_verify_success: [`rate>=${thresholds.verifyRate}`],
        worker_health_check: ['rate==1'],
        worker_teardown_runs: ['count>0'],
    },
};

export default function () {
    const run = config.runId || generateRunId('cron');

    const seedStart = Date.now();
    const seedRes = http.post(
        `${config.proxyUrl}/cron/seed`,
        JSON.stringify({ count: config.seedCount, run }),
        SEED_PARAMS,
    );
    workerMetrics.seedDuration.add(Date.now() - seedStart);
    const seeded = check(seedRes, {
        'cron: seed 200': (r) => r.status === 200,
        'cron: seeded correct amount': (r) => {
            try { return r.json().count === config.seedCount; } catch (e) { return false; }
        },
    });
    if (!seeded) return;
    let seedRun = run;
    try { seedRun = seedRes.json().run || run; } catch (e) { /* keep local run */ }

    // Poll until the sweeper drains every seeded ACTIVE/expired row. The
    // sweeper's backlog gauge is a heuristic (batch+1 while batches stay full),
    // so the DB count from /verify/cron is the authority here; the gauge is
    // sampled only to report how deep the queue got.
    const drainStart = Date.now();
    let remaining = -1;
    let drained = false;
    let backlogPeak = 0;
    while (Date.now() - drainStart < config.cronVerifyTimeoutMs) {
        try {
            const r = http.get(`${config.proxyUrl}/verify/cron?run=${seedRun}`, DRAIN_PARAMS);
            if (r.status === 200) {
                const body = r.json();
                remaining = body.remaining;
                if (remaining === 0) { drained = true; break; }
            }
        } catch (e) { /* retry */ }
        const series = fetchWorkerSeries(WORKER_METRICS_URL);
        if (series) {
            const backlog = seriesValue(series, 'worker_cron_expired_backlog');
            if (backlog > backlogPeak) {
                backlogPeak = backlog;
                workerMetrics.backlogPeak.add(backlog);
            }
        }
        sleep(config.cronVerifyPollMs / 1000);
    }
    workerMetrics.drainDuration.add(Date.now() - drainStart);
    workerMetrics.verifySuccess.add(drained);
    check(drained, {
        'cron: sweeper drained backlog': (v) => v === true,
    });
    if (!drained) {
        console.log(`cron: drain timeout run=${seedRun} remaining=${remaining} budget_ms=${config.cronVerifyTimeoutMs}`);
    }
}

// Runs after the drain check. The backlog gauge is only zeroed by the next
// empty sweep, which happens after the 5s batch cooldown, so wait for it to
// settle before asserting instead of racing that sweep.
export function teardown(data) {
    workerMetrics.teardownRuns.add(1);
    if (data && data.mock) {
        console.log('teardown: mock proxy, skipping worker signal assertions');
        return;
    }

    if (data && typeof data.startedAt === 'number') {
        const startedAt = processStartTime(WORKER_METRICS_URL);
        recordHealth('worker did not restart', startedAt === data.startedAt,
            `start_time=${startedAt} setup_start_time=${data.startedAt}`);
    }

    const series = waitForWorkerSignal(WORKER_METRICS_URL, (s) => seriesValue(s, 'worker_cron_expired_backlog') === 0);
    if (!series) return recordHealth('worker /metrics reachable', false, WORKER_METRICS_URL);
    recordHealth('worker /metrics reachable', true, WORKER_METRICS_URL);
    assertSeries(series, 'sweeper swept jobs', 'worker_jobs_processed_total', { labels: { job_type: 'user_downgrade' }, min: 1 });
    assertSeries(series, 'sweeper completed a sweep', 'worker_cron_loop_iterations_total', { labels: { result: 'success' }, min: 1 });
    assertSeries(series, 'sweeper had no loop errors', 'worker_cron_loop_iterations_total', { labels: { result: 'error' }, exact: 0 });
    assertSeries(series, 'sweeper backlog settled', 'worker_cron_expired_backlog', { exact: 0 });
    assertSeries(series, 'sweeper dead-lettered nothing', 'worker_dead_lettered_total', { exact: 0 });
}

export function handleSummary(data) {
    return printSummary([
        `cron seed=${config.seedCount} run=${config.runId || 'local'}`,
        `checks=${metricRate(data, 'checks')}`,
        `seed_p95=${metricP(data, 'worker_seed_duration', 95)}ms`,
        `drain=${metricP(data, 'worker_drain_duration', 95)}ms`,
        `backlog_peak=${metricValue(data, 'worker_backlog_peak', 'value')}`,
        `worker_health=${metricRate(data, 'worker_health_check')}`,
    ]);
}
