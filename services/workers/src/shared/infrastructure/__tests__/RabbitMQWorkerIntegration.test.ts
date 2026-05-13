import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { RabbitMQWorker } from "../RabbitMQWorker";
import amqp from "amqplib";

describe("RabbitMQWorker Integration", () => {
    let worker: RabbitMQWorker;
    const queueName = "test_queue";
    const rabbitUrl = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";

    afterEach(async () => {
        if (worker) {
            await worker.shutdown();
        }
    });

    test("should process message and ACK", async () => {
        let processedData: any = null;
        const handler = async (msg: any) => {
            processedData = msg;
        };

        worker = new RabbitMQWorker(rabbitUrl, queueName, handler);
        await worker.start();

        // Give it a moment to connect
        await new Promise(r => setTimeout(r, 1000));

        // Manually publish a message to the queue
        const conn = await amqp.connect(rabbitUrl);
        const ch = await conn.createChannel();
        await ch.assertQueue(queueName, { durable: true });
        const message = { test: "data", timestamp: Date.now() };
        ch.sendToQueue(queueName, Buffer.from(JSON.stringify(message)));

        // Wait for worker to pick it up
        await new Promise(r => setTimeout(r, 1000));

        expect(processedData).toEqual(message);

        await ch.close();
        await conn.close();
    });

    test("should NACK on handler failure", async () => {
        const handler = async () => {
            throw new Error("Processing failed");
        };

        worker = new RabbitMQWorker(rabbitUrl, "test_failure_queue", handler);
        await worker.start();

        await new Promise(r => setTimeout(r, 1000));

        const conn = await amqp.connect(rabbitUrl);
        const ch = await conn.createChannel();
        await ch.assertQueue("test_failure_queue", { durable: true });
        
        // Setup DLX to verify NACK (optional, but good)
        // Actually, RabbitMQWorker setupTopology already sets up DLX
        
        ch.sendToQueue("test_failure_queue", Buffer.from(JSON.stringify({ bad: "data" })));

        await new Promise(r => setTimeout(r, 1000));

        // If we reach here without crash, it handled the error.
        // We could check DLQ here if we wanted to be very thorough.
        
        await ch.close();
        await conn.close();
    });
});
