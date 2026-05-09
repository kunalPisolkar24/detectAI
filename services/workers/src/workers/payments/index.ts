import { RabbitMQWorker } from "../../shared/infrastructure/RabbitMQWorker";
import { PaymentService } from "./services/PaymentService";
import { PrismaUserRepository } from "@shared/repositories/UserRepository";
import { PaddleClient } from "./gateways/PaddleClient";
import { SubscriptionUpdatedHandler } from "./handlers/SubscriptionUpdatedHandler";
import { SubscriptionCanceledHandler } from "./handlers/SubscriptionCanceledHandler";
import { UserCancelHandler } from "./handlers/UserCancelHandler";
import { prisma, prismaPrimary } from "@shared/db";
import { RedisFactory } from "@shared/redis";
import { LockService } from "@shared/cache/lock";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/infrastructure/WorkerServer";
import { config } from "./config";

const QUEUE_NAME = "payment_events";

const redisClient = RedisFactory.createClient({
    mode: config.REDIS_MODE,
    name: "PaymentsRedis",
    url: config.REDIS_URL,
    sentinels: config.REDIS_SENTINELS,
    masterName: config.REDIS_MASTER_NAME,
    password: process.env.REDIS_PASSWORD,
});

const metricsService = new MetricsService("worker-payments");
const lockService = new LockService(redisClient);

const userRepository = new PrismaUserRepository(prismaPrimary, prisma);
const paddleClient = new PaddleClient(config.PADDLE_API_KEY, config.PADDLE_ENVIRONMENT);

const subscriptionUpdatedHandler = new SubscriptionUpdatedHandler(userRepository, redisClient, lockService, metricsService);
const subscriptionCanceledHandler = new SubscriptionCanceledHandler(userRepository, redisClient, metricsService);
const userCancelHandler = new UserCancelHandler(paddleClient);

const paymentService = new PaymentService(
    {
        "subscription.created": subscriptionUpdatedHandler,
        "subscription.updated": subscriptionUpdatedHandler,
        "subscription.canceled": subscriptionCanceledHandler,
        "user.cancel_subscription": userCancelHandler,
    },
    metricsService
);

const worker = new RabbitMQWorker(
    config.RABBITMQ_URL,
    QUEUE_NAME,
    async (event: any) => await paymentService.handleEvent(event),
    "quorum"
);

worker.start();
metricsService.activeWorkers.inc();

const server = new WorkerServer(
    metricsService,
    config.PORT,
    () => worker.getStatus()
);

server.start();

const shutdown = async () => {
    metricsService.activeWorkers.dec();
    await prisma.$disconnect();
    await redisClient.quit();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
