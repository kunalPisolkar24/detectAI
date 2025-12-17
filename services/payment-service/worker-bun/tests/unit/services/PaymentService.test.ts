import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { prismaMock, mockUserUpdate, mockUserUpdateMany } from "../../mocks/db";
import { getSubscriptionCreatedEvent, getSubscriptionCanceledEvent, getUserCancelRequestEvent } from "../../fixtures/paddleEvents";

mock.module("../../../src/lib/db", () => prismaMock);

import { PaymentService } from "../../../src/services/PaymentService";

const originalFetch = global.fetch;
const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify({ success: true }))));

describe("PaymentService", () => {
    let service: PaymentService;

    beforeEach(() => {
        service = new PaymentService();
        mockUserUpdate.mockClear();
        mockUserUpdateMany.mockClear();
        mockFetch.mockClear();
        global.fetch = mockFetch as unknown as typeof fetch;
        process.env.PADDLE_API_KEY = "test_key";
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test("should update user details when subscription is created", async () => {
        const event = getSubscriptionCreatedEvent();
        await service.handleEvent(event as any);

        expect(mockUserUpdate).toHaveBeenCalled();
        const callArgs = (mockUserUpdate.mock.calls as any)[0][0];
        expect(callArgs.where.id).toBe("user_abc");
        expect(callArgs.data.paddleSubscriptionStatus).toBe("ACTIVE");
    });

    test("should mark subscription as canceled in database when receiving canceled event", async () => {
        const event = getSubscriptionCanceledEvent();
        await service.handleEvent(event as any);

        expect(mockUserUpdateMany).toHaveBeenCalled();
        const callArgs = (mockUserUpdateMany.mock.calls as any)[0][0];
        expect(callArgs.where.paddleSubscriptionId).toBe("sub_123");
        expect(callArgs.data.paddleSubscriptionStatus).toBe("CANCELED");
    });

    test("should call external API when user requests cancellation", async () => {
        const event = getUserCancelRequestEvent();
        await service.handleEvent(event as any);

        expect(mockUserUpdate).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalled();
        const url = (mockFetch.mock.calls as any)[0][0] as string;
        expect(url).toContain("/subscriptions/sub_to_cancel/cancel");
    });
});