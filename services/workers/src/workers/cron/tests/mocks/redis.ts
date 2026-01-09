import { mock } from "bun:test";

export const mockDel = mock(() => Promise.resolve(0));
export const mockQuit = mock(() => Promise.resolve("OK"));

export const redisMock = {
    redis: {
        del: mockDel,
        quit: mockQuit,
    },
};