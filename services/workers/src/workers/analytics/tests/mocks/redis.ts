import { mock } from "bun:test";

export const mockUsageClient = {
  spop: mock(() => Promise.resolve([])),
  sadd: mock(() => Promise.resolve(0)),
  get: mock(() => Promise.resolve(null)),
  decrby: mock(() => Promise.resolve(0)),
  quit: mock(() => Promise.resolve("OK")),
  status: "ready",
  on: mock(),
};

export const mockMainClient = {
  del: mock(() => Promise.resolve(0)),
  quit: mock(() => Promise.resolve("OK")),
  status: "ready",
  on: mock(),
};

export const redisFactoryMock = {
  RedisFactory: {
    createClient: mock((url: string, mode: string, name: string) => {
      if (name === "AnalyticsUsage") return mockUsageClient;
      if (name === "AnalyticsMain") return mockMainClient;
      return mockMainClient;
    }),
  },
};