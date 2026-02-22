import { describe, test, expect, mock, beforeEach } from "bun:test";
import { amqpMock, mockChannel, mockAck, mockNack, mockOn } from "../../mocks/amqplib";

const originalExit = process.exit;
const mockExit = mock(() => { throw new Error("process.exit called"); });
process.exit = mockExit as any;


mock.module("amqplib", () => amqpMock);

const { RabbitMQWorker } = await import("@shared/infrastructure/RabbitMQWorker");

describe("RabbitMQWorker", () => {
    let worker: any;
    let mockHandler: any;

    beforeEach(() => {
        mockHandler = mock(() => Promise.resolve());
        mockAck.mockClear();
        mockNack.mockClear();
        mockChannel.consume.mockClear();
        worker = new RabbitMQWorker("amqp://localhost", "test_queue", mockHandler);
    });

    test("should establish connection and setup queue", async () => {
        await worker.start();
        expect(mockChannel.assertQueue).toHaveBeenCalled();
        expect(mockChannel.consume).toHaveBeenCalled();
        expect(worker.getStatus()).toBe(true);
    });

    test("should acknowledge message on successful processing", async () => {
        await worker.start();

        // Ensure consume was called before accessing args
        expect(mockChannel.consume).toHaveBeenCalled();

        // Use non-null assertion (!) because we asserted strictly above
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
        worker = new RabbitMQWorker("amqp://localhost", "test_queue", failingHandler);

        await worker.start();

        expect(mockChannel.consume).toHaveBeenCalled();

        // Use non-null assertion (!)
        const onMessageCallback = mockChannel.consume.mock.calls[0]![1];

        const fakeMsg = {
            content: Buffer.from(JSON.stringify({ event_type: "test" })),
        };

        await onMessageCallback(fakeMsg);

        expect(failingHandler).toHaveBeenCalled();
        expect(mockNack).toHaveBeenCalledWith(fakeMsg, false, false);
    });

    test("should handle connection close event", async () => {
        await worker.start();

        expect(mockOn).toHaveBeenCalledWith("close", expect.any(Function));

        const closeCallback = mockOn.mock.calls.find(call => call[0] === "close")?.[1];
        expect(closeCallback).toBeDefined();

        try {
            closeCallback();
        } catch (e: any) {
            expect(e.message).toBe("process.exit called");
        }

        expect(mockExit).toHaveBeenCalledWith(1);
    });
});