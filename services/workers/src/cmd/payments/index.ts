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
import { prismaPrimary, getPgPool, closePrisma } from "@shared/database/PrismaService";
import { prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { IdempotencyStore } from "@shared/cache/IdempotencyStore";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/infrastructure/WorkerServer";
import { Logger } from "@shared/logging/Logger";
import { config } from "./config";

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
try {
    const primaryPool = getPgPool("primary");
    if (primaryPool) metricsService.registerPool("primary", primaryPool);
    const replicaPool = getPgPool("replica");
    if (replicaPool && replicaPool !== primaryPool) metricsService.registerPool("replica", replicaPool);
} catch {}

redisClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 1));
redisClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 1));
redisClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 0));
redisClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "PaymentsRedis" }, 0));

// EventRedis persists payment:event:ts:* dedup keys via AOF (--appendonly yes, save "900 1 300 10").
// Verify with: redis-cli -a $EVENT_REDIS_PASSWORD INFO persistence | grep -E 'aof_enabled:1|rdb_last_bgsave_status:ok'
// Do NOT run redis-events with --save "" --appendonly no (cache-only) — wipes dedup state on restart.
eventRedisClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 1));
eventRedisClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 1));
eventRedisClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 0));
eventRedisClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "EventRedis" }, 0));

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
    (config as any).RABBITMQ_QUEUE_TYPE ?? "classic",
    Object.keys(paymentHandlers)
);

let isShuttingDown = false;

// withTimeout that properly cancels the dangling promise's unhandled rejection
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutPromise = new Promise<T>(resolve => {
    timeout = setTimeout(() => {
      timedOut = true;
      resolve(fallback);
    }, ms);
  });
  // Prevent unhandled rejection if the original promise rejects after timeout
  promise.catch(() => {});
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timeout) clearTimeout(timeout);
    // If we timed out, the original promise continues in background but its rejection is already caught
    void promise.catch(() => {});
  }
}

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
        const pool = getPgPool("primary");
        const waiting = pool ? pool.waitingCount : 0;
        // Only mark not-ready on sustained pressure, not transient >0 flapping
        const poolPressured = waiting > 5;

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
        // poolPressured is a readiness signal but not the sole determinant — include in checks
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
