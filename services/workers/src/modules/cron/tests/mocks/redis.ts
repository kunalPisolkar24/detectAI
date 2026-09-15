import { mock } from "bun:test";

export const mockRedisClient = {
  del: mock(() => Promise.resolve(0)),
  unlink: mock(() => Promise.resolve(0)),
  quit: mock(() => Promise.resolve("OK")),
  status: "ready",
  on: mock(),
  pipeline: mock(() => ({
    del: mock(),
    unlink: mock(),
    exec: mock(() => Promise.resolve([])),
  })),
};

export const redisFactoryMock = {
  RedisFactory: {
    createClient: mock(() => mockRedisClient),
  },
};