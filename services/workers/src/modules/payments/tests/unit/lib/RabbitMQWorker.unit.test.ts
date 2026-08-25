import { describe, test, expect, mock, beforeEach } from "bun:test";
import { amqpMock, mockChannel, mockAck, mockNack, mockOn } from "../../mocks/amqplib";
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
        worker = new RabbitMQWorker("amqp://localhost", "test_queue", mockHandler, metrics);
    });

    test("should establish connection and setup queue", async () => {
        await worker.start();
        expect(mockChannel.assertQueue).toHaveBeenCalled();
        expect(mockChannel.consume).toHaveBeenCalled();
        expect(worker.getStatus()).toBe(true);
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
        const failingHandler = mock(() => Promise.reject(new Error("Fail")));
        worker = new RabbitMQWorker("amqp://localhost", "test_queue", failingHandler, metrics);
        await worker.start();
        expect(mockChannel.consume).toHaveBeenCalled();
        const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
        const fakeMsg = {
            content: Buffer.from(JSON.stringify({ event_type: "test" })),
        };
        await onMessageCallback(fakeMsg);
        expect(failingHandler).toHaveBeenCalled();
        expect(mockNack).toHaveBeenCalledWith(fakeMsg, false, false);
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
        expect(mockAck).not.toHaveBeenCalled();
        expect(mockNack).not.toHaveBeenCalled();
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
        };

        await onMessageCallback(fakeMsg);
        expect(failingHandler).toHaveBeenCalled();
        expect(mockNack).not.toHaveBeenCalled();
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