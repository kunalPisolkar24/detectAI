import { mock } from "bun:test";

export const mockRedisClient = {
  del: mock(() => Promise.resolve(0)),
  quit: mock(() => Promise.resolve("OK")),
  status: "ready",
  on: mock(),
};

export const redisFactoryMock = {
  RedisFactory: {
    createClient: mock(() => mockRedisClient),
  },
};