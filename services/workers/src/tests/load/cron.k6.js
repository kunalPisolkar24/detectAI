import http from 'k6/http';
import { check, sleep } from 'k6';
import { config, thresholds } from './lib/config.js';
import { workerMetrics } from './lib/metrics.js';
import { generateRunId } from './lib/data.js';

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

export const options = {
    vus: 1,
    iterations: 1,
    gracefulStop: '5m',
    thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: [`p(95)<${thresholds.seedP95}`],
        worker_seed_duration: [`p(95)<${thresholds.seedP95}`],
        checks: [`rate>=${thresholds.successRate}`],
    },
};

export default function () {
    const run = config.runId || generateRunId('cron');

    const seedStart = Date.now();
    const seedRes = http.post(
        `${config.proxyUrl}/cron/seed`,
        JSON.stringify({ count: config.seedCount, run }),
        JSON_HEADERS,
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

    // Poll until the sweeper drains every seeded ACTIVE/expired row.
    const drainStart = Date.now();
    let remaining = -1;
    let drained = false;
    while (Date.now() - drainStart < config.cronVerifyTimeoutMs) {
        try {
            const r = http.get(`${config.proxyUrl}/verify/cron?run=${seedRun}`);
            if (r.status === 200) {
                const body = r.json();
                remaining = body.remaining;
                if (remaining === 0) { drained = true; break; }
            }
        } catch (e) { /* retry */ }
        sleep(config.cronVerifyPollMs / 1000);
    }
    workerMetrics.drainDuration.add(Date.now() - drainStart);
    workerMetrics.verifySuccess.add(drained);
    check(drained, {
        'cron: sweeper drained backlog': (v) => v === true,
    });
    if (!drained) {
        console.log(`cron: drain timeout run=${seedRun} remaining=${remaining}`);
    }
}

export function handleSummary(data) {
    const lines = [
        `cron seed=${config.seedCount}`,
        `checks=${data.metrics.checks ? data.metrics.checks.values.rate.toFixed(4) : 'n/a'}`,
        `seed_p95=${data.metrics.worker_seed_duration ? data.metrics.worker_seed_duration.values['p(95)'].toFixed(1) : 'n/a'}ms`,
        `drain_p95=${data.metrics.worker_drain_duration ? data.metrics.worker_drain_duration.values['p(95)'].toFixed(1) : 'n/a'}ms`,
    ];
    return { stdout: lines.join('\n') + '\n' };
}
