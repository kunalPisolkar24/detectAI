import http from 'k6/http';
import { sleep } from 'k6';
import { config } from './config.js';
import { workerMetrics } from './metrics.js';

// Verify reads are the second measured phase. They get their own tags so the
// ingest SLOs below are not diluted by (or diluted into) row-polling latency.
const VERIFY_PARAMS = { tags: { phase: 'verify' } };

// Polls a proxy /verify endpoint until accept(body) is true or the deadline
// passes. One call records exactly one verification sample, however many polls
// it took.
export function pollVerify(url, accept, timeoutMs = config.verifyTimeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let body = null;
    let verified = false;
    while (Date.now() < deadline) {
        const t0 = Date.now();
        try {
            const res = http.get(url, VERIFY_PARAMS);
            workerMetrics.verifyDuration.add(Date.now() - t0);
            if (res.status === 200) {
                try { body = res.json(); } catch (e) { body = null; }
                if (body && accept(body)) { verified = true; break; }
            }
        } catch (e) { /* retry until deadline */ }
        // Sleep only with budget left, so the call never overruns timeoutMs by
        // a whole poll interval and blocks its VU longer than configured.
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        sleep(Math.min(config.verifyPollMs, remaining) / 1000);
    }
    workerMetrics.verifySuccess.add(verified);
    workerMetrics.verifySamples.add(1);
    if (!verified) console.warn(`verify failed url=${url} body=${JSON.stringify(body)}`);
    return { verified, body };
}