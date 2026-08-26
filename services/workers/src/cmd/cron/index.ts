import { SubscriptionSweeper } from "@modules/cron/application/services/SubscriptionSweeper";
import { prisma, prismaPrimary, getPgPool } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { Logger } from "@shared/logging/Logger";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/infrastructure/WorkerServer";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { config } from "./config";

const BATCH_COOLDOWN_MS = 5000;
const ERROR_COOLDOWN_MS = 60000;
const SHUTDOWN_GRACE_MS = 10000;

function jitter(intervalMs: number): number {
    return Math.round(intervalMs * (0.9 + Math.random() * 0.2));
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}

const redisClient = RedisFactory.createClient({
    mode: config.REDIS_MODE,
    name: "CronRedis",
    url: config.REDIS_URL,
    sentinels: config.REDIS_SENTINELS,
    masterName: config.REDIS_MASTER_NAME,
    password: config.REDIS_PASSWORD,
});

const metricsService = new MetricsService("worker-cron");
metricsService.registerPool("primary", getPgPool("primary")!);
metricsService.registerPool("replica", getPgPool("replica")!);

redisClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 1));
redisClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 1));
redisClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 0));
redisClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 0));

const userRepository = new PrismaUserRepository(prismaPrimary, prisma);
const sweeper = new SubscriptionSweeper(userRepository, redisClient, metricsService, config.CRON_BATCH_SIZE);

const server = new WorkerServer(
    metricsService,
    config.PORT || 7777,
    () => true,
    async () => {
        if (redisClient.status !== "ready") return false;
        try {
            await prisma.$queryRaw`SELECT 1`;
            return true;
        } catch {
            return false;
        }
    }
);

server.start();

let isShuttingDown = false;
let currentJob: Promise<number> | null = null;

const abort = new AbortController();

async function startWorker(): Promise<void> {
    Logger.info(`Cron Worker (Subscription Sweeper) initializing. Check interval: ${config.CRON_CHECK_INTERVAL_MS}ms.`);

    while (!isShuttingDown) {
        try {
            currentJob = sweeper.processExpiredSubscriptions();
            const processedCount = await currentJob;
            currentJob = null;

            if (processedCount > 0) {
                Logger.info(`Sweeper processed ${processedCount} records. Checking for more in ${BATCH_COOLDOWN_MS}ms...`);
                await abortableSleep(BATCH_COOLDOWN_MS, abort.signal);
            } else {
                const sleepMs = jitter(config.CRON_CHECK_INTERVAL_MS);
                Logger.info(`No expired subscriptions found. Sleeping for ${Math.round(sleepMs / 1000)}s.`);
                await abortableSleep(sleepMs, abort.signal);
            }
        } catch (error) {
            currentJob = null;
            Logger.error("Critical error in Cron loop", error);
            metricsService.jobErrors.inc({ job_type: "cron_loop", error_type: "critical" });
            await abortableSleep(ERROR_COOLDOWN_MS, abort.signal);
        }
    }
}

const loopDone = startWorker();
loopDone.catch(error => {
    metricsService.activeWorkers.dec();
    Logger.error("Cron worker crashed during startup or execution", error);
    process.exit(1);
});

const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    Logger.info("Shutting down Cron Worker...");
    server.stop();
    abort.abort();

    if (currentJob) {
        await Promise.race([
            currentJob.catch(() => {}),
            new Promise(resolve => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
        ]);
    }

    await Promise.race([
        loopDone.catch(() => {}),
        new Promise(resolve => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
    ]);

    metricsService.activeWorkers.dec();

    await prisma.$disconnect();
    await redisClient.quit();

    Logger.info("Cron Worker exited gracefully");
    process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
