import { mock } from "bun:test";

export function makeRedisMock(overrides: Record<string, unknown> = {}) {
    return {
        del: mock(() => Promise.resolve(0)),
        set: mock(() => Promise.resolve("OK")),
        quit: mock(() => Promise.resolve("OK")),
        ping: mock(() => Promise.resolve("PONG")),
        status: "ready",
        on: mock(),
        unlink: mock(() => Promise.resolve(0)),
        pipeline: mock(() => ({
            del: mock(),
            unlink: mock(),
            exec: mock(() => Promise.resolve([])),
        })),
        ...overrides,
    };
}

export const mockRedisClient = makeRedisMock();
export const mockMainClient = makeRedisMock();

export const redisFactoryMock = {
    RedisFactory: {
        createClient: mock(() => mockRedisClient),
    },
};
