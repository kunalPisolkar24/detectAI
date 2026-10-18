// Shared k6 load knobs for the workers rigs (mirrors chats tests/load/lib/config.js).
// Generic VUS/DURATION/RPS win over per-script defaults so one interface drives
// every script: make load-test WORKER=payments VUS=10 DURATION=2m RPS=50 SCENARIO=load
function intOr(env, fallback) {
    const v = parseInt(__ENV[env] || '');
    return Number.isFinite(v) && v > 0 ? v : fallback;
}

function floatOr(env, fallback) {
    const v = parseFloat(__ENV[env] || '');
    return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function strOr(env, fallback) {
    return __ENV[env] || fallback;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

const genericVUs = intOr('VUS', 0);
const genericDuration = strOr('DURATION', '');
const genericRps = intOr('RPS', 0);

export const config = {
    proxyUrl: __ENV.PROXY_URL || 'http://localhost:9999',
    scenario: (strOr('SCENARIO', 'load') || 'load').toLowerCase(),
    runId: strOr('RUN_ID', ''),
    // When the proxy runs with MOCK_MODE=true no rows are ever written, so
    // verification is skipped at runtime and its thresholds are omitted.
    mockMode: strOr('MOCK_MODE', '') === 'true',
    // Raw generic overrides; 0 / '' mean "unset" so per-scenario defaults apply.
    vusOverride: genericVUs,
    durationOverride: genericDuration,
    rpsOverride: genericRps,
    // Distinct users per run. Keeps DB bounded (pool) instead of unbounded
    // VU*ITER growth, while still allowing contention via small pools.
    poolSize: intOr('POOL_SIZE', 100),
    // Share of iterations that publish the same event id twice (worker dedup path).
    // Short correctness runs raise this so the "dedup was exercised" assertion
    // is deterministic instead of a 5% coin flip.
    dupWeight: clamp(floatOr('DUP_WEIGHT', 0.05), 0, 0.5),
    // Share of iterations that use a single-use user and then verify the row
    // exists with the expected shape. 0 disables verification and trips the
    // worker_verify_samples threshold on purpose (red-run check).
    verifySampleRate: clamp(floatOr('VERIFY_SAMPLE_RATE', 0.1), 0, 1),
    // Verify polling (payments/analytics sample, cron drain wait). An in-loop
    // poll holds the VU for up to verifyTimeoutMs, so keep it bounded.
    verifyTimeoutMs: intOr('VERIFY_TIMEOUT_MS', 5000),
    verifyPollMs: intOr('VERIFY_POLL_MS', 500),
    cronVerifyTimeoutMs: intOr('CRON_VERIFY_TIMEOUT_MS', 180000),
    cronVerifyPollMs: intOr('CRON_VERIFY_POLL_MS', 2000),
    // Load control (generic VUS/DURATION first, per-script fallback)
    analyticsVUs: genericVUs || intOr('ANALYTICS_VUS', 10),
    analyticsDuration: genericDuration || strOr('ANALYTICS_DURATION', '30s'),
    analyticsRps: genericRps || intOr('ANALYTICS_RPS', 20),
    paymentsVUs: genericVUs || intOr('PAYMENTS_VUS', 10),
    paymentsDuration: genericDuration || strOr('PAYMENTS_DURATION', '30s'),
    paymentsRps: genericRps || intOr('PAYMENTS_RPS', 10),
    // Worker /metrics scrape and queue drain waits used by teardown assertions.
    workerMetricsUrl: strOr('WORKER_METRICS_URL', ''),
    signalTimeoutMs: intOr('SIGNAL_TIMEOUT_MS', 20000),
    signalPollMs: intOr('SIGNAL_POLL_MS', 1000),
    seedCount: intOr('SEED_COUNT', 1000),
};

export const thresholds = {
    successRate: floatOr('THRESHOLD_SUCCESS_RATE', 0.99),
    ingestP95: intOr('THRESHOLD_INGEST_P95', 800),
    ingestP99: intOr('THRESHOLD_INGEST_P99', 2000),
    verifyP95: intOr('THRESHOLD_VERIFY_P95', 1500),
    seedP95: intOr('THRESHOLD_SEED_P95', 5000),
    drainP95: intOr('THRESHOLD_DRAIN_P95', 120000),
    negativeRate: floatOr('THRESHOLD_NEGATIVE_RATE', 0.99),
    verifyRate: floatOr('THRESHOLD_VERIFY_RATE', 0.9),
};
