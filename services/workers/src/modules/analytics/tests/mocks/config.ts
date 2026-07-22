export const configMock = {
  config: {
    DATABASE_URL: "postgresql://localhost:5432/testdb",
    REDIS_URL: "redis://localhost:6379/0",
    RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
    NODE_ENV: "test",
    PORT: 7777
  },
  baseEnvSchema: {
    parse: () => ({
      DATABASE_URL: "postgresql://localhost:5432/testdb",
      REDIS_URL: "redis://localhost:6379/0",
      RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
      NODE_ENV: "test",
      PORT: 7777
    })
  }
};
