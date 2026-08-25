import { RabbitMQWorker } from "@shared/messaging/RabbitMQWorker";
import { PaymentService } from "@modules/payments/application/services/PaymentService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { PaddleClient } from "@modules/payments/infrastructure/external/PaddleClient";
import { SubscriptionUpdatedHandler } from "@modules/payments/application/handlers/SubscriptionUpdatedHandler";
import { SubscriptionCanceledHandler } from "@modules/payments/application/handlers/SubscriptionCanceledHandler";
import { UserCancelHandler } from "@modules/payments/application/handlers/UserCancelHandler";
import { prisma, prismaPrimary } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
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

const eventRedisClient = RedisFactory.createClient({
    mode: config.EVENT_REDIS_MODE,
    name: "EventRedis",
    url: config.EVENT_REDIS_URL,
    sentinels: config.EVENT_REDIS_SENTINELS,
    masterName: config.EVENT_REDIS_MASTER_NAME,
    password: config.EVENT_REDIS_PASSWORD,
});

const metricsService = new MetricsService("worker-payments");
metricsService.registerPool("primary", prismaPrimary);
metricsService.registerPool("replica", prisma);

redisClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 1));
redisClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 1));
redisClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 0));
redisClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 0));

eventRedisClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 1));
eventRedisClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 1));
eventRedisClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 0));
eventRedisClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 0));

const userRepository = new PrismaUserRepository(prismaPrimary, prisma);
const paddleClient = new PaddleClient(config.PADDLE_API_KEY, config.PADDLE_ENVIRONMENT);

const subscriptionUpdatedHandler = new SubscriptionUpdatedHandler(userRepository, redisClient, eventRedisClient, metricsService);
const subscriptionCanceledHandler = new SubscriptionCanceledHandler(userRepository, redisClient, eventRedisClient, metricsService);
const userCancelHandler = new UserCancelHandler(userRepository, paddleClient, redisClient, eventRedisClient, metricsService);

const paymentHandlers = {
    "subscription.created": subscriptionUpdatedHandler,
    "subscription.updated": subscriptionUpdatedHandler,
    "subscription.activated": subscriptionUpdatedHandler,
    "subscription.canceled": subscriptionCanceledHandler,
    "user.cancel_subscription": userCancelHandler,
} as const;

const paymentService = new PaymentService(paymentHandlers, metricsService);

const worker = new RabbitMQWorker(
    config.RABBITMQ_URL,
    QUEUE_NAME,
    async (event: any) => await paymentService.handleEvent(event),
    metricsService,
    config.RABBITMQ_QUEUE_TYPE ?? "classic",
    Object.keys(paymentHandlers)
);

worker.start();
metricsService.activeWorkers.inc();

const server = new WorkerServer(
    metricsService,
    config.PORT,
    () => true,
    () => worker.getStatus()
);

server.start();

const shutdown = async () => {
    metricsService.activeWorkers.dec();
    server.stop();
    await worker.shutdown();
    await prisma.$disconnect();
    await redisClient.quit();
    await eventRedisClient.quit();
    process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
