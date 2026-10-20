import { describe, test, expect, mock, beforeEach } from "bun:test";

const pool = { waitingCount: 0, totalCount: 2, idleCount: 2 };

mock.module("@shared/database/PrismaService", () => ({
    prismaPrimary: {
        $queryRaw: () => Promise.resolve([{ "1": 1 }]),
    },
    getPgPool: () => pool,
}));

// Shrink the timeout so the timeout path is reachable without a 3s wait.
mock.module("@shared/utils/withTimeout", () => ({
    withTimeout: (promise: Promise<unknown>, _ms: number, fallback: unknown) =>
        Promise.race([
            promise,
            new Promise((resolve) => setTimeout(() => resolve(fallback), 5)),
        ]),
}));

const { checkDb, checkRedis, getPoolWaiting, isPoolPressured } = await import("../checks");

const redisClient = (ping: () => Promise<string>, status = "ready") => ({ ping, status }) as any;

describe("checkRedis", () => {
    test("returns true when Redis answers PONG", async () => {
        const client = redisClient(() => Promise.resolve("PONG"));

        expect(await checkRedis(client)).toBe(true);
    });

    test("returns false when Redis answers anything other than PONG", async () => {
        // A Redis that is loading, busy or redirecting answers PING with an error
        // string. The socket can still be "ready", so the connection status must
        // not stand in for a real PONG.
        const client = redisClient(() => Promise.resolve("LOADING Redis is loading the dataset in memory"));

        expect(await checkRedis(client)).toBe(false);
    });

    test("returns false when ping throws", async () => {
        const client = redisClient(() => Promise.reject(new Error("ECONNRESET")));

        expect(await checkRedis(client)).toBe(false);
    });

    test("returns false when the ping never answers", async () => {
        const client = redisClient(() => new Promise<string>(() => {}));

        expect(await checkRedis(client)).toBe(false);
    });
});

describe("checkDb", () => {
    test("returns true when the query succeeds", async () => {
        expect(await checkDb()).toBe(true);
    });
});

describe("isPoolPressured", () => {
    beforeEach(() => {
        pool.waitingCount = 0;
    });

    test("is not pressured at the threshold", () => {
        pool.waitingCount = 5;

        expect(isPoolPressured()).toBe(false);
    });

    test("is pressured above the threshold", () => {
        pool.waitingCount = 6;

        expect(isPoolPressured()).toBe(true);
    });

    test("getPoolWaiting reports the waiting count", () => {
        pool.waitingCount = 3;

        expect(getPoolWaiting()).toBe(3);
    });
});
