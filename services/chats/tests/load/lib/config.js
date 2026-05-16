export const config = {
    target: __ENV.CHAT_SERVICE_ADDR || 'localhost:50051',
    plaintext: __ENV.CHAT_SERVICE_PLAINTEXT !== 'false',
    timeout: __ENV.CHAT_SERVICE_TIMEOUT || '5s',
    rpcTimeoutMs: parseInt(__ENV.RPC_TIMEOUT_MS || '2000'),
    e2eTimeoutMs: parseInt(__ENV.E2E_TIMEOUT_MS || '5000'),
    e2ePollingIntervalMs: parseInt(__ENV.E2E_POLLING_INTERVAL_MS || '200'),
    // Load control
    smokeVUs: parseInt(__ENV.SMOKE_VUS || '1'),
    smokeDuration: __ENV.SMOKE_DURATION || '10s',
    loadVUs: parseInt(__ENV.LOAD_VUS || '10'),
    loadDuration: __ENV.LOAD_DURATION || '2m',
    stressVUs: parseInt(__ENV.STRESS_VUS || '50'),
    stressDuration: __ENV.STRESS_DURATION || '5m',
    soakVUs: parseInt(__ENV.SOAK_VUS || '5'),
    soakDuration: __ENV.SOAK_DURATION || '10m',
};

export const thresholds = {
    successRate: parseFloat(__ENV.THRESHOLD_SUCCESS_RATE || '0.99'),
    saveMessageP95: parseInt(__ENV.THRESHOLD_SAVE_MESSAGE_P95 || '100'),
    saveMessageP99: parseInt(__ENV.THRESHOLD_SAVE_MESSAGE_P99 || '250'),
    getHistoryP95: parseInt(__ENV.THRESHOLD_GET_HISTORY_P95 || '200'),
    e2eLatencyP95: parseInt(__ENV.THRESHOLD_E2E_LATENCY_P95 || '1000'),
};
