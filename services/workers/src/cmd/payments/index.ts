import { loadPaymentsConfig } from "./config";
import { initTracing } from "@shared/tracing/instrumentation";
import { RabbitMQWorker } from "@shared/messaging/RabbitMQWorker";
import { PaymentService } from "@modules/payments/application/services/PaymentService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { PaddleClient } from "@modules/payments/infrastructure/external/PaddleClient";
import { SubscriptionUpdatedHandler } from "@modules/payments/application/handlers/SubscriptionUpdatedHandler";
import { SubscriptionCanceledHandler } from "@modules/payments/application/handlers/SubscriptionCanceledHandler";
import { UserCancelHandler } from "@modules/payments/application/handlers/UserCancelHandler";
import { validateTransition } from "@modules/payments/domain/stateMachine";
import { prismaPrimary, prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { IdempotencyStore } from "@shared/cache/IdempotencyStore";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/http/WorkerServer";
import { Logger } from "@shared/logging/Logger";
import { checkDb, checkRedis, registerPools, wireRedisMetrics, getPoolWaiting, isPoolPressured } from "@shared/health/checks";
import { withTimeout } from "@shared/utils/withTimeout";

const QUEUE_NAME = "payment_events";

async function main(): Promise<void> {
  const config = await loadPaymentsConfig();
  initTracing(config.OTEL_SERVICE_NAME ?? "worker-payments");

  const redisClient = RedisFactory.createClient({
    name: "PaymentsRedis",
    url: config.REDIS_URL,
    password: config.REDIS_PASSWORD,
  });

  const eventRedisClient = RedisFactory.createClient({
    name: "EventRedis",
    url: config.EVENT_REDIS_URL,
    password: config.EVENT_REDIS_PASSWORD,
  });

  const metricsService = new MetricsService("worker-payments");
  registerPools(metricsService);
  wireRedisMetrics(redisClient, metricsService, "PaymentsRedis");
  wireRedisMetrics(eventRedisClient, metricsService, "EventRedis");

  const userRepository = new PrismaUserRepository(prismaPrimary, prisma, validateTransition, metricsService);
  const paddleClient = new PaddleClient(config.PADDLE_API_KEY, config.PADDLE_ENVIRONMENT, 10_000, metricsService);
  const idempotencyStore = new IdempotencyStore(eventRedisClient, prismaPrimary as any, metricsService);

  const handlers = {
    "subscription.created": new SubscriptionUpdatedHandler(userRepository, redisClient, eventRedisClient, metricsService),
    "subscription.updated": new SubscriptionUpdatedHandler(userRepository, redisClient, eventRedisClient, metricsService),
    "subscription.activated": new SubscriptionUpdatedHandler(userRepository, redisClient, eventRedisClient, metricsService),
    "subscription.canceled": new SubscriptionCanceledHandler(userRepository, redisClient, eventRedisClient, metricsService),
    "user.cancel_subscription": new UserCancelHandler(userRepository, paddleClient, redisClient, eventRedisClient, metricsService),
  } as const;

  const paymentService = new PaymentService(handlers, metricsService, idempotencyStore);

  const worker = new RabbitMQWorker(
    config.RABBITMQ_URL!,
    QUEUE_NAME,
    (event) => paymentService.handleEvent(event),
    metricsService,
    Object.keys(handlers),
    {
      prefetch: config.RABBITMQ_PREFETCH,
      infraRequeueDelayMs: config.INFRA_REQUEUE_DELAY_MS,
      isInfraHealthy: checkDb,
    }
  );

  let isShuttingDown = false;

  const server = new WorkerServer(
    metricsService,
    config.PORT,
    () => (isShuttingDown ? { healthy: false, checks: { isShuttingDown: true } } : { healthy: true, checks: { isShuttingDown } }),
    async () => {
      if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true } };
      const waiting = getPoolWaiting();
      const poolPressured = isPoolPressured();
      const [dbOk, redisOk, eventRedisOk] = await Promise.all([checkDb(), checkRedis(redisClient), checkRedis(eventRedisClient)]);
      const workerOk = worker.getStatus();
      const healthy = dbOk && redisOk && eventRedisOk && workerOk && !poolPressured;
      return { healthy, checks: { db: dbOk, redis: redisOk, eventRedis: eventRedisOk, rabbitmq: workerOk, poolWaiting: waiting, poolPressured, isShuttingDown } };
    }
  );

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await withTimeout(prismaPrimary.$queryRaw`SELECT 1`, 3000, null as any);
      await withTimeout(redisClient.ping(), 3000, null as any);
      await withTimeout(eventRedisClient.ping(), 3000, null as any);
      break;
    } catch (e) {
      Logger.warn(`Payments bootstrap waiting for deps (attempt ${attempt}/5)`, { error: e });
      if (attempt < 5) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  server.start();
  metricsService.activeWorkers.inc();

  worker.start().catch((err) => {
    Logger.error("Payments worker failed to start", err);
    process.exit(1);
  });

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    try {
      metricsService.activeWorkers.dec();
    } catch {}
    try {
      server.stop();
    } catch {}
    try {
      await Promise.race([worker.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10000))]);
    } catch {}
    try {
      const { closePrisma } = await import("@shared/database/PrismaService");
      await closePrisma();
    } catch {}
    for (const c of [redisClient, eventRedisClient]) {
      try {
        await Promise.race([c.quit(), new Promise((_, rej) => setTimeout(() => rej(new Error("quit timeout")), 5000))]);
      } catch {}
    }
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGQUIT", shutdown);
  process.on("unhandledRejection", (reason: any) => Logger.error("Unhandled rejection in payments worker", reason));
  process.on("uncaughtException", (err: any) => Logger.error("Uncaught exception in payments worker", err));
}

main().catch((err) => {
  Logger.error("Payments bootstrap failed", err);
  process.exit(1);
});
