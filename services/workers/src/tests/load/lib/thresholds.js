import { config, thresholds } from './config.js';

// Happy-path SLOs shared by the queue-backed workers (payments/analytics).
//
// http_req_* is gated per phase, never globally: setup probes, /verify polling
// and teardown scrapes all emit untagged http_req_* samples, so a single
// retried /ready probe would otherwise be counted as an ingest failure and a
// short run (load-check is ~60 requests) turns one such sample into a breach.
// Requests tagged `phase:setup` or `phase:probe` are intentionally ungated.
//
// Deliberately absent:
// - worker_negative_check: only the edge scenario emits samples, and k6
//   silently ignores Rate thresholds that have zero samples, so carrying it
//   here would just look like a gate that never fires.
// - Trend thresholds prove nothing without samples either (an empty Trend
//   evaluates to 0 and passes `p(95)<N`), which is why every metric that only
//   teardown feeds is paired with a Counter tripwire below.
export function baseThresholds() {
    const t = {
        'http_req_failed{phase:ingest}': ['rate<0.01'],
        'http_req_failed{phase:verify}': ['rate<0.01'],
        'http_req_duration{phase:ingest}': [`p(95)<${thresholds.ingestP95}`, `p(99)<${thresholds.ingestP99}`],
        'http_req_duration{phase:verify}': [`p(95)<${thresholds.verifyP95}`],
        worker_ingest_duration: [`p(95)<${thresholds.ingestP95}`, `p(99)<${thresholds.ingestP99}`],
        worker_ingest_success: [`rate>=${thresholds.successRate}`],
        worker_verify_duration: [`p(95)<${thresholds.verifyP95}`],
        worker_verify_success: [`rate>=${thresholds.verifyRate}`],
        // Teardown asserts worker-side signals (counters, queue depths); a
        // single failed assertion fails the run. rate==1 has no samples when
        // teardown exits early (mock proxy), which k6 ignores.
        worker_health_check: ['rate==1'],
        // Zero-sample counters fail count>0, so this proves teardown executed.
        worker_teardown_runs: ['count>0'],
        checks: [`rate>=${thresholds.successRate}`],
        // Arrival-rate executors drop iterations when every allowed VU is busy
        // (verify polling blocks one VU per sample), which would silently lower
        // the configured rate; zero-sample counters fail count>0.
        dropped_iterations: ['count==0'],
    };
    if (!config.mockMode) {
        t.worker_verify_samples = ['count>0'];
    }
    return t;
}
