import { describe, test, expect, mock, afterEach } from "bun:test";
import { PaddleClient } from "@modules/payments/infrastructure/external/PaddleClient";

const originalFetch = globalThis.fetch;

describe("PaddleClient", () => {
    let client: PaddleClient;

    const buildClient = (timeoutMs = 10_000) => new PaddleClient("test-key", "sandbox", timeoutMs);

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("sends cancellation with an abort signal and succeeds on 200", async () => {
        const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })));
        globalThis.fetch = fetchMock as any;
        client = buildClient();

        await client.cancelSubscription("sub_123");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, options] = fetchMock.mock.calls[0]! as any[];
        expect(url).toContain("/subscriptions/sub_123/cancel");
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    test("treats 409 as already-canceled without throwing", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(new Response(JSON.stringify({ error: "already canceled" }), { status: 409 }))
        ) as any;
        client = buildClient();

        await expect(client.cancelSubscription("sub_123")).resolves.toBeUndefined();
    });

    test("includes status and parsed body in the error for JSON failures", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response(JSON.stringify({ error: { detail: "plan locked" } }), { status: 500 })
            )
        ) as any;
        client = buildClient();

        await expect(client.cancelSubscription("sub_123")).rejects.toThrow(
            "Paddle API error 500"
        );
    });

    test("does not crash on non-JSON error bodies", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(new Response("<html>Bad Gateway</html>", { status: 502 }))
        ) as any;
        client = buildClient();

        await expect(client.cancelSubscription("sub_123")).rejects.toThrow(
            "Paddle API error 502"
        );
    });
});
