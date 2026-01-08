export const configMock = {
  config: {
    DATABASE_URL: "postgresql://localhost:5432/testdb",
    REDIS_USAGE_URL: "redis://localhost:6379/1",
    REDIS_URL: "redis://localhost:6379/0",
    NODE_ENV: "test",
    PORT: 7777
  },
  baseEnvSchema: {
    parse: () => ({
      DATABASE_URL: "postgresql://localhost:5432/testdb",
      REDIS_URL: "redis://localhost:6379/0",
      REDIS_USAGE_URL: "redis://localhost:6379/1",
      NODE_ENV: "test",
      PORT: 7777
    })
  }
};