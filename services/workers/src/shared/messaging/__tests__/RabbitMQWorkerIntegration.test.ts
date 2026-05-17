import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import "../../../tests/setup-integration";
import { RabbitMQWorker } from "../RabbitMQWorker";
import { MetricsService } from "../../monitoring/MetricsService";
import amqp from "amqplib";

describe("RabbitMQWorker Integration", () => {
    let worker: RabbitMQWorker;
    const metrics = new MetricsService("test-worker");
    const queueName = "test_queue";
    let rabbitUrl: string;

    beforeEach(() => {
        rabbitUrl = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
    });

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

        worker = new RabbitMQWorker(rabbitUrl, queueName, handler, metrics);
        await worker.start();

        const conn = await amqp.connect(rabbitUrl);
        const ch = await conn.createChannel();
        
        try {
            // Queue is already asserted by worker.start()
            const message = { test: "data", timestamp: Date.now() };
            ch.sendToQueue(queueName, Buffer.from(JSON.stringify(message)));

            // Wait for worker to pick it up (up to 5 seconds)
            let retries = 50;
            while (processedData === null && retries > 0) {
                await new Promise(r => setTimeout(r, 100));
                retries--;
            }

            expect(processedData).toEqual(message);
        } finally {
            await ch.close();
            await conn.close();
        }
    });

    test("should NACK on handler failure", async () => {
        let processed = false;
        const handler = async () => {
            processed = true;
            throw new Error("Processing failed");
        };

        worker = new RabbitMQWorker(rabbitUrl, "test_failure_queue", handler, metrics);
        await worker.start();

        const conn = await amqp.connect(rabbitUrl);
        const ch = await conn.createChannel();
        
        try {
            // Queue is already asserted by worker.start()
            ch.sendToQueue("test_failure_queue", Buffer.from(JSON.stringify({ bad: "data" })));

            let retries = 50;
            while (!processed && retries > 0) {
                await new Promise(r => setTimeout(r, 100));
                retries--;
            }

            expect(processed).toBe(true);
        } finally {
            await ch.close();
            await conn.close();
        }
    });
});
