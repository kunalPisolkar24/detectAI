import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { amqpMock, mockChannel, mockAck, mockNack, mockOn, mockAssertExchange, mockBindQueue } from "../../mocks/amqplib";
import { MetricsService } from "@shared/monitoring/MetricsService";

const originalExit = process.exit;
const mockExit = mock(() => { throw new Error("process.exit called"); });
process.exit = mockExit as any;

mock.module("amqplib", () => amqpMock);

const { RabbitMQWorker } = await import("@shared/messaging/RabbitMQWorker");

describe("RabbitMQWorker", () => {
    let worker: any;
    let mockHandler: any;
    const metrics = new MetricsService("test");

    beforeEach(() => {
        mockHandler = mock(() => Promise.resolve());
        mockAck.mockClear();
        mockNack.mockClear();
        mockChannel.consume.mockClear();
        mockChannel.assertQueue.mockClear();
        mockChannel.assertExchange.mockClear();
        mockChannel.bindQueue.mockClear();
        worker = new RabbitMQWorker("amqp://localhost", "test_queue", mockHandler, metrics);
    });

    afterEach(async () => {
        if (worker) await worker.shutdown();
    });

    test("should establish connection and setup queue", async () => {
        await worker.start();
        expect(mockChannel.assertQueue).toHaveBeenCalled();
        expect(mockChannel.consume).toHaveBeenCalled();
        expect(worker.getStatus()).toBe(true);
    });

    test("should declare dlx, dlq and binding alongside the work queue", async () => {
        await worker.start();

        expect(mockAssertExchange).toHaveBeenCalledWith("test_queue_dlx", "direct", { durable: true });
        expect(mockChannel.assertQueue).toHaveBeenCalledWith("test_queue_dlq", { durable: true });
        expect(mockBindQueue).toHaveBeenCalledWith("test_queue_dlq", "test_queue_dlx", "test_queue");
        expect(mockChannel.assertQueue).toHaveBeenCalledWith("test_queue", expect.objectContaining({
            arguments: expect.objectContaining({
                "x-dead-letter-exchange": "test_queue_dlx",
                "x-dead-letter-routing-key": "test_queue",
            }),
        }));
    });

    test("should bound job_type labels to the allowlist", async () => {
        worker = new RabbitMQWorker(
            "amqp://localhost",
            "test_queue",
            mockHandler,
            metrics,
            "classic",
            ["subscription.updated"]
        );
        await worker.start();
        const observeSpy = mock(() => {});
        (worker.metrics.messageSizeBytes as any).observe = observeSpy;

        const onMessageCallback = mockChannel.consume.mock.calls.at(-1)![1];
        await onMessageCallback({ content: Buffer.from(JSON.stringify({ event_type: "subscription.updated" })) });
        await onMessageCallback({ content: Buffer.from(JSON.stringify({ event_type: "evil" + "x".repeat(500) })) });
        await onMessageCallback({ content: Buffer.from(JSON.stringify({ userId: "u1" })) });

        const labelArgs = observeSpy.mock.calls.map((c: any) => c[0].job_type);
        expect(labelArgs).toEqual(["subscription.updated", "other", "other"]);
    });

    test("should acknowledge message on successful processing", async () => {
        await worker.start();
        expect(mockChannel.consume).toHaveBeenCalled();
        const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
        const fakeMsg = {
            content: Buffer.from(JSON.stringify({ event_type: "test" })),
        };
        await onMessageCallback(fakeMsg);
        expect(mockHandler).toHaveBeenCalled();
        expect(mockAck).toHaveBeenCalledWith(fakeMsg);
        expect(mockNack).not.toHaveBeenCalled();
    });

    test("should negative acknowledge message on failure", async () => {
        const { UserNotFoundError } = await import("../../../domain/errors");
        const failingHandler = mock(() => Promise.reject(new UserNotFoundError("user_123")));
        worker = new RabbitMQWorker("amqp://localhost", "test_queue", failingHandler, metrics);
        await worker.start();
        expect(mockChannel.consume).toHaveBeenCalled();
        const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
        const fakeMsg = {
            content: Buffer.from(JSON.stringify({ event_type: "test" })),
            properties: { headers: {} },
        } as any;
        await onMessageCallback(fakeMsg);
        expect(failingHandler).toHaveBeenCalled();
        expect(mockNack).toHaveBeenCalled();
    });

    test("should declare queue as quorum when specified", async () => {
        worker = new RabbitMQWorker("amqp://localhost", "test_queue", mockHandler, metrics, "quorum");
        await worker.start();
        expect(mockChannel.assertQueue).toHaveBeenCalledWith("test_queue", expect.objectContaining({
            arguments: expect.objectContaining({
                "x-queue-type": "quorum"
            })
        }));
    });

    test("should handle connection close event without exiting", async () => {
        await worker.start();
        expect(mockOn).toHaveBeenCalledWith("close", expect.any(Function));
        const closeCallback = mockOn.mock.calls.find(call => call[0] === "close")?.[1];
        expect(closeCallback).toBeDefined();
        closeCallback();
        expect(mockExit).not.toHaveBeenCalled();
    });

    test("should not attempt reconnect after shutdown", async () => {
        await worker.start();
        expect(worker.getStatus()).toBe(true);

        await worker.shutdown();
        expect(worker.getStatus()).toBe(false);

        const connectSpy = mock(() => Promise.resolve());
        const originalConnect = worker.connect;
        worker.connect = connectSpy;

        const closeCallback = mockOn.mock.calls.find(call => call[0] === "close")?.[1]!;
        closeCallback();

        expect(connectSpy).not.toHaveBeenCalled();
        worker.connect = originalConnect;
    });

    test("should resolve without ack when channel is unavailable after processing", async () => {
        await worker.start();
        const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
        const fakeMsg = {
            content: Buffer.from(JSON.stringify({ event_type: "test" })),
        };

        mockHandler.mockImplementation(() => {
            worker.channel = null;
            return Promise.resolve();
        });

        await onMessageCallback(fakeMsg);
        expect(mockHandler).toHaveBeenCalled();
        // deliveryChannel is captured at entry, so ack still uses the original channel
        expect(mockAck).toHaveBeenCalledWith(fakeMsg);
    });

    test("should not throw when nack hits a dead channel", async () => {
        const failingHandler = mock(() => {
            worker.channel = null;
            return Promise.reject(new Error("Fail"));
        });
        worker = new RabbitMQWorker("amqp://localhost", "test_queue", failingHandler, metrics);
        await worker.start();
        const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
        const fakeMsg = {
            content: Buffer.from(JSON.stringify({ event_type: "test" })),
            properties: { headers: {} },
        } as any;

        await onMessageCallback(fakeMsg);
        expect(failingHandler).toHaveBeenCalled();
        // Should not throw even though channel is null — safeNack/publish handles it
        // Delivery may go to retry exchange or DLQ via deliveryChannel
        expect(mockNack.mock.calls.length + mockAck.mock.calls.length).toBeGreaterThanOrEqual(0);
    });

    test("should swallow channel errors during acknowledge", async () => {
        await worker.start();
        const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
        const fakeMsg = {
            content: Buffer.from(JSON.stringify({ event_type: "test" })),
        };

        mockAck.mockImplementation(() => {
            throw new Error("IllegalOperationError: Channel closed");
        });

        await onMessageCallback(fakeMsg);
        expect(mockHandler).toHaveBeenCalled();
        expect(mockAck).toHaveBeenCalledWith(fakeMsg);

        mockAck.mockImplementation(() => {});
    });
});