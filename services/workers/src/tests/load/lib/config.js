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

const genericVUs = intOr('VUS', 0);
const genericDuration = strOr('DURATION', '');
const genericRps = intOr('RPS', 0);

export const config = {
    proxyUrl: __ENV.PROXY_URL || 'http://localhost:9999',
    scenario: (strOr('SCENARIO', 'load') || 'load').toLowerCase(),
    runId: strOr('RUN_ID', ''),
    rps: genericRps,
    // Distinct users per run. Keeps DB bounded (pool) instead of unbounded
    // VU*ITER growth, while still allowing contention via small pools.
    poolSize: intOr('POOL_SIZE', 100),
    // Verify polling (payments/analytics sample, cron drain wait).
    verifyTimeoutMs: intOr('VERIFY_TIMEOUT_MS', 15000),
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
    seedCount: intOr('SEED_COUNT', 1000),
};

export const thresholds = {
    successRate: floatOr('THRESHOLD_SUCCESS_RATE', 0.99),
    ingestP95: intOr('THRESHOLD_INGEST_P95', 800),
    ingestP99: intOr('THRESHOLD_INGEST_P99', 2000),
    verifyP95: intOr('THRESHOLD_VERIFY_P95', 1500),
    seedP95: intOr('THRESHOLD_SEED_P95', 5000),
    negativeRate: floatOr('THRESHOLD_NEGATIVE_RATE', 0.99),
    verifyRate: floatOr('THRESHOLD_VERIFY_RATE', 0.9),
};
