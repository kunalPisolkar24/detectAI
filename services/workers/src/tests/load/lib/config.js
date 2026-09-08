// Shared k6 load knobs for the workers rigs (mirrors chats tests/load/lib/config.js).
// Generic VUS/DURATION/RPS win over per-script defaults so one interface drives
// every script: make load-test WORKER=payments VUS=10 DURATION=2m RPS=50
function intOr(env, fallback) {
    const v = parseInt(__ENV[env] || '');
    return Number.isFinite(v) && v > 0 ? v : fallback;
}

function strOr(env, fallback) {
    return __ENV[env] || fallback;
}

const genericVUs = intOr('VUS', 0);
const genericDuration = strOr('DURATION', '');
const genericRps = intOr('RPS', 0);

export const config = {
    proxyUrl: __ENV.PROXY_URL || 'http://localhost:9999',
    rps: genericRps,
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
    successRate: parseFloat(__ENV.THRESHOLD_SUCCESS_RATE || '0.99'),
};
