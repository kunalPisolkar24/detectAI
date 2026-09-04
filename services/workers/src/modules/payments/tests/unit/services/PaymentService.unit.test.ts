import { describe, test, expect, mock, beforeEach } from "bun:test";
import { UserNotFoundError } from "../../../domain/errors";

const mockLogger = { info: mock(), error: mock(), warn: mock() };
mock.module("@shared/logging/Logger", () => ({ Logger: mockLogger }));

const { PaymentService } = await import("../../../application/services/PaymentService");

const createMetricsMock = () => {
    const jobTimer = mock();
    return ({
    jobDuration: { startTimer: mock(() => jobTimer) },
    jobTimer,
    jobTotal: { inc: mock() },
    jobErrors: { inc: mock() },
    cacheOperations: { inc: mock() },
    activeJobs: { inc: mock(), dec: mock() },
    rabbitmqConnectionStatus: { set: mock() },
    rabbitmqReconnections: { inc: mock() },
    redisConnectionStatus: { set: mock() },
    messageSizeBytes: { observe: mock() },
    deadLetteredTotal: { inc: mock() },
    unhandledEventsTotal: { inc: mock() },
    });
};

describe("PaymentService", () => {
    let metricsMock: ReturnType<typeof createMetricsMock>;
    let mockSubscriptionHandler: { handle: ReturnType<typeof mock> };
    let mockCancelHandler: { handle: ReturnType<typeof mock> };

    beforeEach(() => {
        metricsMock = createMetricsMock();
        mockLogger.error.mockClear();
        mockLogger.warn.mockClear();

        mockSubscriptionHandler = { handle: mock(() => Promise.resolve()) };
        mockCancelHandler = { handle: mock(() => Promise.resolve()) };
    });

    const buildService = () => new PaymentService(
        {
            "subscription.created": mockSubscriptionHandler as any,
            "subscription.updated": mockSubscriptionHandler as any,
            "subscription.canceled": mockSubscriptionHandler as any,
            "user.cancel_subscription": mockCancelHandler as any,
        },
        metricsMock as any
    );

    test("routes subscription.created to the correct handler", async () => {
        const service = buildService();
        const event = {
            event_type: "subscription.created",
            data: { custom_data: { userId: "user_1" } }
        };
        await service.handleEvent(event as any);
        expect(mockSubscriptionHandler.handle).toHaveBeenCalledWith("user_1", event.data);
        expect(metricsMock.jobTotal.inc).toHaveBeenCalledWith({ job_type: "subscription.created" });
    });

    test("routes subscription.updated to the correct handler", async () => {
        const service = buildService();
        const event = {
            event_type: "subscription.updated",
            data: { custom_data: { userId: "user_1" } }
        };
        await service.handleEvent(event as any);
        expect(mockSubscriptionHandler.handle).toHaveBeenCalledWith("user_1", event.data);
    });

    test("routes user.cancel_subscription without requiring userId", async () => {
        const service = buildService();
        const event = {
            event_type: "user.cancel_subscription",
            data: { paddleSubscriptionId: "sub_1" }
        };
        await service.handleEvent(event as any);
        expect(mockCancelHandler.handle).toHaveBeenCalledWith(null, event.data);
    });

    test("ignores events without userId for non-cancel event types", async () => {
        const service = buildService();
        const event = {
            event_type: "subscription.updated",
            data: {}
        };
        await expect(service.handleEvent(event as any)).rejects.toThrow("userId");
        expect(mockSubscriptionHandler.handle).not.toHaveBeenCalled();
        expect(metricsMock.jobTotal.inc).not.toHaveBeenCalled();
        expect(metricsMock.jobErrors.inc).toHaveBeenCalledWith({ job_type: "subscription.updated", error_type: "missing_userId" });
    });

    test("logs warning and ignores unknown event types", async () => {
        const service = buildService();
        const event = {
            event_type: "unknown.event",
            data: { custom_data: { userId: "user_1" } }
        };
        await service.handleEvent(event as any);
        expect(mockLogger.warn).toHaveBeenCalled();
        expect(metricsMock.unhandledEventsTotal.inc).toHaveBeenCalledWith({ event_type: "other" });
        expect(metricsMock.jobTotal.inc).not.toHaveBeenCalled();
    });

    test("routes user-not-found failures onto the DLQ path", async () => {
        const service = buildService();
        const notFound = new UserNotFoundError("user_1");
        mockSubscriptionHandler.handle.mockRejectedValue(notFound);
        const event = {
            event_type: "subscription.updated",
            data: { custom_data: { userId: "user_1" } }
        };

        await expect(service.handleEvent(event as any)).rejects.toBe(notFound);

        expect(metricsMock.jobErrors.inc).toHaveBeenCalledWith({
            job_type: "subscription.updated",
            error_type: "user_not_found",
        });
        expect(metricsMock.jobTimer).toHaveBeenCalledWith({ status: "dlq" });
    });

    test("re-throws handler errors and records error metrics", async () => {
        const service = buildService();
        mockSubscriptionHandler.handle.mockRejectedValue(new Error("Handler failure"));
        const event = {
            event_type: "subscription.created",
            data: { custom_data: { userId: "user_1" } }
        };
        await expect(service.handleEvent(event as any)).rejects.toThrow("Handler failure");
        expect(metricsMock.jobErrors.inc).toHaveBeenCalledWith({
            job_type: "subscription.created",
            error_type: "process_failure"
        });
        expect(mockLogger.error).toHaveBeenCalled();
    });
});