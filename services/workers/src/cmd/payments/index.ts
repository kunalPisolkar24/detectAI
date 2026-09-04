import { initTracing } from "@shared/tracing/instrumentation";
initTracing("worker-payments");

import { RabbitMQWorker } from "@shared/messaging/RabbitMQWorker";
import { PaymentService } from "@modules/payments/application/services/PaymentService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { PaddleClient } from "@modules/payments/infrastructure/external/PaddleClient";
import { SubscriptionUpdatedHandler } from "@modules/payments/application/handlers/SubscriptionUpdatedHandler";
import { SubscriptionCanceledHandler } from "@modules/payments/application/handlers/SubscriptionCanceledHandler";
import { UserCancelHandler } from "@modules/payments/application/handlers/UserCancelHandler";
import { validateTransition } from "@modules/payments/domain/stateMachine";
import { prismaPrimary, closePrisma } from "@shared/database/PrismaService";
import { prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { IdempotencyStore } from "@shared/cache/IdempotencyStore";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/infrastructure/WorkerServer";
import { Logger } from "@shared/logging/Logger";
import { config } from "./config";
import { withTimeout } from "@shared/utils/withTimeout";
import { registerPools, wireRedisMetrics, getPoolWaiting, isPoolPressured, checkDb, checkRedis } from "@shared/health/checks";

const QUEUE_NAME = "payment_events";

const redisClient = RedisFactory.createClient({
    mode: config.REDIS_MODE,
    name: "PaymentsRedis",
    url: config.REDIS_URL,
    sentinels: config.REDIS_SENTINELS,
    masterName: config.REDIS_MASTER_NAME,
    password: (config as any).REDIS_PASSWORD,
});

const eventRedisClient = RedisFactory.createClient({
    mode: (config as any).EVENT_REDIS_MODE,
    name: "EventRedis",
    url: (config as any).EVENT_REDIS_URL,
    sentinels: (config as any).EVENT_REDIS_SENTINELS,
    masterName: (config as any).EVENT_REDIS_MASTER_NAME,
    password: (config as any).EVENT_REDIS_PASSWORD,
});

const metricsService = new MetricsService("worker-payments");
registerPools(metricsService);

wireRedisMetrics(redisClient, metricsService, "PaymentsRedis");
// EventRedis persists payment:event:ts:* dedup keys via AOF (--appendonly yes, save "900 1 300 10").
// Verify with: redis-cli -a $EVENT_REDIS_PASSWORD INFO persistence | grep -E 'aof_enabled:1|rdb_last_bgsave_status:ok'
// Do NOT run redis-events with --save "" --appendonly no (cache-only) — wipes dedup state on restart.
wireRedisMetrics(eventRedisClient, metricsService, "EventRedis");

const userRepository = new PrismaUserRepository(prismaPrimary, prisma, validateTransition, metricsService);
const paddleClient = new PaddleClient(config.PADDLE_API_KEY, (config as any).PADDLE_ENVIRONMENT, 10_000, metricsService);
const idempotencyStore = new IdempotencyStore(eventRedisClient, prismaPrimary as any, metricsService);

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

const paymentService = new PaymentService(paymentHandlers, metricsService, idempotencyStore);

const worker = new RabbitMQWorker(
    (config as any).RABBITMQ_URL,
    QUEUE_NAME,
    async (event: any) => await paymentService.handleEvent(event),
    metricsService,
    config.RABBITMQ_QUEUE_TYPE,
    Object.keys(paymentHandlers)
);

let isShuttingDown = false;

// Liveness = process alive; readiness = deps
const server = new WorkerServer(
    metricsService,
    config.PORT,
    () => {
        // Liveness: never fail on downstream — only on shutting down
        if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true } };
        return { healthy: true, checks: { isShuttingDown } };
    },
    async () => {
        if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true } };
        const waiting = getPoolWaiting();
        const poolPressured = isPoolPressured();
        const dbOk = await checkDb();
        const [redisOk, eventRedisOk] = await Promise.all([checkRedis(redisClient), checkRedis(eventRedisClient)]);
        const workerOk = worker.getStatus();
        const healthy = dbOk && redisOk && eventRedisOk && workerOk && !poolPressured;
        return { healthy, checks: { db: dbOk, redis: redisOk, eventRedis: eventRedisOk, rabbitmq: workerOk, poolWaiting: waiting, poolPressured, isShuttingDown } };
    }
);

async function bootstrap(): Promise<void> {
    // Ensure DB/Redis are reachable before consuming — avoids immediate crash loops
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await withTimeout(prismaPrimary.$queryRaw`SELECT 1`, 3000, null as any);
            await withTimeout(redisClient.ping(), 3000, null as any);
            await withTimeout(eventRedisClient.ping(), 3000, null as any);
            break;
        } catch (e) {
            Logger.warn(`Payments bootstrap waiting for deps (attempt ${attempt}/${maxAttempts})`, { error: e });
            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 2000));
        }
    }

    server.start();
    metricsService.activeWorkers.inc();

    // Start consuming only after server is listening and deps are ready
    worker.start().catch((err) => {
        Logger.error("Payments worker failed to start", err);
        process.exit(1);
    });
}

bootstrap().catch((err) => {
    Logger.error("Payments bootstrap failed", err);
    process.exit(1);
});

const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    metricsService.activeWorkers.dec();
    try {
        server.stop();
    } catch {}
    // Bounded shutdown: worker drain first, then DB/Redis with timeouts
    try {
        await Promise.race([
            worker.shutdown(),
            new Promise<void>((resolve) => setTimeout(resolve, 10000)),
        ]);
    } catch (e: any) {
        Logger.warn("Worker shutdown error", { error: e instanceof Error ? e.message : String(e) });
    }
    try {
        await closePrisma();
    } catch (e: any) {
        Logger.warn("Prisma close error", { error: e instanceof Error ? e.message : String(e) });
    }
    try {
        await Promise.race([redisClient.quit(), new Promise((_, rej) => setTimeout(() => rej(new Error("redis quit timeout")), 5000))]);
    } catch {}
    try {
        await Promise.race([eventRedisClient.quit(), new Promise((_, rej) => setTimeout(() => rej(new Error("eventRedis quit timeout")), 5000))]);
    } catch {}
    process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("SIGQUIT", shutdown);
process.on("unhandledRejection", (reason: any) => {
    Logger.error("Unhandled rejection in payments worker", reason);
});
process.on("uncaughtException", (err: any) => {
    Logger.error("Uncaught exception in payments worker", err);
    // Don't crash immediately — let shutdown handle it
});
