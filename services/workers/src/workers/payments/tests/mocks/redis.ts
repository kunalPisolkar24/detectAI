import { mock } from "bun:test";

export const mockRedisDel = mock((...args: any[]) => Promise.resolve(1));

export const redisMock = {
    redis: {
        del: mockRedisDel,
        quit: mock(() => Promise.resolve("OK")),
        on: mock(),
    }
};