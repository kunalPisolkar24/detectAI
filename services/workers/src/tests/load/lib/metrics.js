import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

// Ingest = proxy POST latency. Verify = proxy GET /verify polling latency.
// Negative checks (invalid payloads) stay separate so they never dilute the
// happy-path success rate. Teardown assertions land on worker_health_check so
// they cannot drown in the thousands of in-run checks.
export const workerMetrics = {
    ingestDuration: new Trend('worker_ingest_duration', true),
    verifyDuration: new Trend('worker_verify_duration', true),
    seedDuration: new Trend('worker_seed_duration', true),
    drainDuration: new Trend('worker_drain_duration', true),
    ingestSuccess: new Rate('worker_ingest_success'),
    verifySuccess: new Rate('worker_verify_success'),
    negativeCheck: new Rate('worker_negative_check'),
    healthCheck: new Rate('worker_health_check'),
    // Verifications attempted; teardown thresholds guarantee this is non-zero
    // so a run that never verified anything cannot pass vacuously.
    verifySamples: new Counter('worker_verify_samples'),
    // Guarantees teardown actually executed (zero-sample counter fails count>0).
    teardownRuns: new Counter('worker_teardown_runs'),
    // Highest sweeper backlog gauge observed while the cron rig waited to drain.
    backlogPeak: new Gauge('worker_backlog_peak'),
};
