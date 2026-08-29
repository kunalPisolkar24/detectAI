import { RabbitMQWorker } from "@shared/messaging/RabbitMQWorker";
import { PaymentService } from "@modules/payments/application/services/PaymentService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { PaddleClient } from "@modules/payments/infrastructure/external/PaddleClient";
import { SubscriptionUpdatedHandler } from "@modules/payments/application/handlers/SubscriptionUpdatedHandler";
import { SubscriptionCanceledHandler } from "@modules/payments/application/handlers/SubscriptionCanceledHandler";
import { UserCancelHandler } from "@modules/payments/application/handlers/UserCancelHandler";
import { validateTransition } from "@modules/payments/domain/stateMachine";
import { prisma, prismaPrimary, getPgPool } from "@shared/database/PrismaService";
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
metricsService.registerPool("primary", getPgPool("primary")!);
metricsService.registerPool("replica", getPgPool("replica")!);

redisClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 1));
redisClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 1));
redisClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 0));
redisClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 0));

eventRedisClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 1));
eventRedisClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 1));
eventRedisClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 0));
eventRedisClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 0));

const userRepository = new PrismaUserRepository(prismaPrimary, prisma, validateTransition);
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

let isShuttingDown = false;

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>(resolve => { timeout = setTimeout(() => resolve(fallback), ms); });
  try { const result = await Promise.race([promise, timeoutPromise]); return result; } finally { if (timeout) clearTimeout(timeout); }
}

const server = new WorkerServer(
    metricsService,
    config.PORT,
    () => {
        if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true } };
        const healthy = worker.getStatus();
        return { healthy, checks: { rabbitmq: healthy, isShuttingDown } };
    },
    async () => {
        if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true } };
        const pool = getPgPool("primary");
        const waiting = pool ? pool.waitingCount : 0;
        if (waiting > 0) return { healthy: false, checks: { poolWaiting: waiting, reason: "pool_waiting" } };

        const dbOk = await withTimeout(
            prismaPrimary.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
            3000,
            false
        );
        const pingWithTimeout = (client: typeof redisClient) => withTimeout(
            (async () => {
                try {
                    const res = await client.ping();
                    return res === "PONG" || client.status === "ready";
                } catch { return false; }
            })(),
            3000,
            false
        );
        const [redisOk, eventRedisOk] = await Promise.all([pingWithTimeout(redisClient), pingWithTimeout(eventRedisClient)]);
        const workerOk = worker.getStatus();
        const healthy = dbOk && redisOk && eventRedisOk && workerOk && waiting === 0;
        return { healthy, checks: { db: dbOk, redis: redisOk, eventRedis: eventRedisOk, rabbitmq: workerOk, poolWaiting: waiting, isShuttingDown } };
    }
);

server.start();
metricsService.activeWorkers.inc();

const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
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
