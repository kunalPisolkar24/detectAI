import { RabbitMQWorker } from "./lib/RabbitMQWorker";
import { PaymentService } from "./services/PaymentService";
import { prisma } from "./lib/db";

const QUEUE_NAME = "payment_events";
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";

const paymentService = new PaymentService();

const worker = new RabbitMQWorker(
    RABBITMQ_URL,
    QUEUE_NAME,
    async (event) => await paymentService.handleEvent(event)
);

worker.start();

const server = Bun.serve({
    port: 7777,
    fetch(req) {
        const { pathname } = new URL(req.url);

        if (pathname === "/health") {
            const isHealthy = worker.getStatus();
            return new Response(
                JSON.stringify({
                    status: isHealthy ? "ok" : "error",
                    worker: isHealthy ? "active" : "disconnected",
                }),
                {
                    status: isHealthy ? 200 : 503,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`Worker listening on http://localhost:${server.port}`);

const shutdown = async () => {
    await prisma.$disconnect();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);