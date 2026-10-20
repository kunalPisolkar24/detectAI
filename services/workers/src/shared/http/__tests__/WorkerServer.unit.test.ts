import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

const mockLogger = { info: mock(), error: mock(), warn: mock() };
mock.module("@shared/logging/Logger", () => ({ Logger: mockLogger }));

// Shrink the timeout so the readiness timeout path is reachable without a 3s wait.
mock.module("@shared/utils/withTimeout", () => ({
    withTimeout: (promise: Promise<unknown>, _ms: number, fallback: unknown) =>
        Promise.race([
            promise,
            new Promise((resolve) => setTimeout(() => resolve(fallback), 5)),
        ]),
}));

const { WorkerServer } = await import("../WorkerServer");

const metricsMock = {
    getMetrics: () => Promise.resolve("# HELP test\n"),
    getContentType: () => "text/plain; version=0.0.4",
} as any;

async function freePort(): Promise<number> {
    const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const port = probe.port;
    probe.stop(true);
    if (port === undefined) throw new Error("could not reserve a port");
    return port;
}

const readJson = async (res: Response): Promise<Record<string, any>> =>
    (await res.json()) as Record<string, any>;

describe("WorkerServer", () => {
    let server: InstanceType<typeof WorkerServer> | null = null;
    let base: string;

    const start = async (health: () => any, ready?: () => any) => {
        const port = await freePort();
        base = `http://localhost:${port}`;
        server = new WorkerServer(metricsMock, port, health, ready);
        server.start();
    };

    beforeEach(() => {
        mockLogger.info.mockClear();
        mockLogger.error.mockClear();
        mockLogger.warn.mockClear();
    });

    afterEach(() => {
        server?.stop();
        server = null;
    });

    test("health returns ok with the checks object", async () => {
        await start(() => ({ healthy: true, checks: { isShuttingDown: false } }));

        const res = await fetch(`${base}/health`);
        const body = await readJson(res);

        expect(res.status).toBe(200);
        expect(body.status).toBe("ok");
        expect(body.checks).toEqual({ isShuttingDown: false });
        expect(typeof body.timestamp).toBe("string");
    });

    test("health returns error and 503 when unhealthy", async () => {
        await start(() => ({ healthy: false, checks: { isShuttingDown: true } }));

        const res = await fetch(`${base}/health`);
        const body = await readJson(res);

        expect(res.status).toBe(503);
        expect(body.status).toBe("error");
    });

    test("ready returns ready and not_ready", async () => {
        await start(
            () => ({ healthy: true, checks: {} }),
            () => ({ healthy: false, checks: { db: false } }),
        );

        const ready = await fetch(`${base}/ready`);
        expect(ready.status).toBe(503);
        expect((await readJson(ready)).status).toBe("not_ready");

        const notReady = await fetch(`${base}/ready`);
        expect((await readJson(notReady)).checks).toEqual({ db: false });
    });

    test("omits checks when the check returns a bare boolean", async () => {
        await start(() => true);

        const res = await fetch(`${base}/health`);
        const body = await readJson(res);

        expect(body.checks).toBeUndefined();
        expect(body.status).toBe("ok");
    });

    test("readiness timeout reports timeout in checks", async () => {
        await start(
            () => ({ healthy: true, checks: {} }),
            () => new Promise(() => {}),
        );

        const res = await fetch(`${base}/ready`);
        const body = await readJson(res);

        expect(res.status).toBe(503);
        expect(body.status).toBe("not_ready");
        expect(body.checks).toEqual({ timeout: true });
    });

    test("a throwing check is reported as an error in checks", async () => {
        await start(() => {
            throw new Error("boom");
        });

        const res = await fetch(`${base}/health`);
        const body = await readJson(res);

        expect(res.status).toBe(503);
        expect(body.status).toBe("error");
        expect(String(body.checks.error)).toContain("boom");
    });

    test("unknown paths return 404 plain text", async () => {
        await start(() => true);

        const res = await fetch(`${base}/nope`);

        expect(res.status).toBe(404);
        expect(await res.text()).toBe("Not Found");
    });

    test("metrics endpoint returns the metrics body", async () => {
        await start(() => true);

        const res = await fetch(`${base}/metrics`);

        expect(res.status).toBe(200);
        expect(await res.text()).toContain("# HELP test");
    });

    test("start throws a helpful log when the port is already in use", async () => {
        const port = await freePort();
        const first = new WorkerServer(metricsMock, port, () => true);
        first.start();

        const second = new WorkerServer(metricsMock, port, () => true);
        expect(() => second.start()).toThrow();

        const logged = mockLogger.error.mock.calls.find((call) =>
            String(call[0]).includes("already in use"),
        );
        expect(logged).toBeDefined();
        expect(String(logged?.[0])).toContain(`port ${port}`);

        first.stop();
    });
});
