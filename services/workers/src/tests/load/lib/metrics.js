import { Trend, Rate } from 'k6/metrics';

// Ingest = proxy POST latency. Verify = proxy GET /verify polling latency.
// Negative checks (invalid payloads) stay separate so they never dilute the
// happy-path success rate.
export const workerMetrics = {
    ingestDuration: new Trend('worker_ingest_duration', true),
    verifyDuration: new Trend('worker_verify_duration', true),
    seedDuration: new Trend('worker_seed_duration', true),
    drainDuration: new Trend('worker_drain_duration', true),
    ingestSuccess: new Rate('worker_ingest_success'),
    verifySuccess: new Rate('worker_verify_success'),
    negativeCheck: new Rate('worker_negative_check'),
};
