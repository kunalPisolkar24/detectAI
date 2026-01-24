import { RabbitMQWorker } from "../../shared/infrastructure/RabbitMQWorker";
import { PaymentService } from "./services/PaymentService";
import { prisma } from "@shared/db";
import { RedisFactory } from "@shared/redis";
import { LockService } from "@shared/cache/lock";
import { config } from "./config";

const QUEUE_NAME = "payment_events";

const redisClient = RedisFactory.createClient(
    config.REDIS_URL,
    config.REDIS_MODE,
    "PaymentsRedis"
);

const lockService = new LockService(redisClient);
const paymentService = new PaymentService(redisClient, lockService);

const worker = new RabbitMQWorker(
    config.RABBITMQ_URL,
    QUEUE_NAME,
    async (event: any) => await paymentService.handleEvent(event)
);

worker.start();

const server = Bun.serve({
    port: config.PORT,
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
    await redisClient.quit();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);