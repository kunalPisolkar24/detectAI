export function makeConfigMock(overrides: Record<string, unknown> = {}) {
    return {
        DATABASE_URL: "postgresql://localhost:5432/testdb",
        DATABASE_URL_REPLICA: "postgresql://localhost:5432/testdb",
        REDIS_URL: "redis://localhost:6379/0",
        REDIS_MODE: "standalone" as const,
        REDIS_SENTINELS: undefined,
        REDIS_MASTER_NAME: undefined,
        REDIS_PASSWORD: undefined,
        RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
        RABBITMQ_QUEUE_TYPE: "classic" as const,
        NODE_ENV: "test" as const,
        PORT: 7777,
        OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
        OTEL_SERVICE_NAME: undefined,
        PADDLE_API_KEY: "test_key",
        PADDLE_ENVIRONMENT: "sandbox" as const,
        EVENT_REDIS_URL: "redis://localhost:6379/1",
        EVENT_REDIS_MODE: "standalone" as const,
        EVENT_REDIS_SENTINELS: undefined,
        EVENT_REDIS_MASTER_NAME: undefined,
        EVENT_REDIS_PASSWORD: undefined,
        CRON_CHECK_INTERVAL_MS: 900_000,
        CRON_BATCH_SIZE: 100,
        ...overrides,
    };
}

export const configMock = makeConfigMock();

export const baseEnvSchemaMock = {
    parse: () => makeConfigMock(),
};
