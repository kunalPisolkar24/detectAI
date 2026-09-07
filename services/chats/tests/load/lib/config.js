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
    target: __ENV.CHAT_SERVICE_ADDR || 'localhost:50051',
    plaintext: __ENV.CHAT_SERVICE_PLAINTEXT !== 'false',
    timeout: __ENV.CHAT_SERVICE_TIMEOUT || '5s',
    rpcTimeoutMs: parseInt(__ENV.RPC_TIMEOUT_MS || '2000'),
    e2eTimeoutMs: parseInt(__ENV.E2E_TIMEOUT_MS || '5000'),
    e2ePollingIntervalMs: parseInt(__ENV.E2E_POLLING_INTERVAL_MS || '200'),
    // Single-knob overrides: VUS/DURATION/RPS win over per-scenario vars
    rps: genericRps,
    // Load control (generic VUS/DURATION first, per-scenario fallback)
    smokeVUs: genericVUs || intOr('SMOKE_VUS', 1),
    smokeDuration: genericDuration || strOr('SMOKE_DURATION', '10s'),
    loadVUs: genericVUs || intOr('LOAD_VUS', 10),
    loadDuration: genericDuration || strOr('LOAD_DURATION', '2m'),
    stressVUs: genericVUs || intOr('STRESS_VUS', 50),
    stressDuration: genericDuration || strOr('STRESS_DURATION', '5m'),
    soakVUs: genericVUs || intOr('SOAK_VUS', 5),
    soakDuration: genericDuration || strOr('SOAK_DURATION', '10m'),
};

export const thresholds = {
    successRate: parseFloat(__ENV.THRESHOLD_SUCCESS_RATE || '0.99'),
    saveMessageP95: parseInt(__ENV.THRESHOLD_SAVE_MESSAGE_P95 || '100'),
    saveMessageP99: parseInt(__ENV.THRESHOLD_SAVE_MESSAGE_P99 || '250'),
    getHistoryP95: parseInt(__ENV.THRESHOLD_GET_HISTORY_P95 || '200'),
    e2eLatencyP95: parseInt(__ENV.THRESHOLD_E2E_LATENCY_P95 || '1000'),
};
