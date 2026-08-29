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
metricsService.cronConfig.set({ param: "check_interval_ms" }, config.CRON_CHECK_INTERVAL_MS);
metricsService.cronConfig.set({ param: "batch_size" }, config.CRON_BATCH_SIZE);

redisClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 1));
redisClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 1));
redisClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 0));
redisClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 0));

const userRepository = new PrismaUserRepository(prismaPrimary, prisma, undefined, metricsService);
const sweeper = new SubscriptionSweeper(userRepository, redisClient, metricsService, config.CRON_BATCH_SIZE);

// liveness heartbeat + shutdown flag — must be defined before WorkerServer so healthCheck can close over them
let isShuttingDown = false;
let currentJob: Promise<number> | null = null;
let lastSuccess = Date.now();
const abort = new AbortController();

function jitter(intervalMs: number): number {
    return Math.round(intervalMs * (0.9 + Math.random() * 0.2));
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
            clearTimeout(timer);
            try { metricsService.shutdownAbortsTotal.inc({ reason: "sleep_aborted" }); } catch {}
            resolve();
        }, { once: true });
    });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>(resolve => { timeout = setTimeout(() => resolve(fallback), ms); });
    try {
        const result = await Promise.race([promise, timeoutPromise]);
        return result;
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

async function updateSubscriptionStatusGauges(): Promise<void> {
    try {
        const groups = await prismaPrimary.subscription.groupBy({
            by: ["status"],
            _count: { status: true },
        });
        for (const g of groups) {
            const status = (g.status ?? "NULL") as string;
            metricsService.subscriptionStatus.set({ status }, g._count.status);
        }
        const known = ["ACTIVE", "PAST_DUE", "PAUSED", "TRIALING", "CANCELED"];
        const seen = new Set(groups.map(g => g.status));
        for (const s of known) if (!seen.has(s as any)) metricsService.subscriptionStatus.set({ status: s }, 0);
    } catch {
        // best-effort; groupBy may fail if replica not ready — ignore for loop liveness
    }
}

const server = new WorkerServer(
    metricsService,
    config.PORT || 7777,
    () => {
        if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true, reason: "shutting_down" } };
        const age = Date.now() - lastSuccess;
        const threshold = 2 * config.CRON_CHECK_INTERVAL_MS;
        const healthy = age < threshold;
        return { healthy, checks: { lastSuccessAgeMs: age, thresholdMs: threshold, isShuttingDown } };
    },
    async () => {
        if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true, reason: "shutting_down" } };
        // Pool waiting pressure — if waiting>0, pool exhausted, not ready for new jobs
        const pool = getPgPool("primary");
        const waiting = pool ? pool.waitingCount : 0;
        if (waiting > 0) return { healthy: false, checks: { db: false, redis: false, poolWaiting: waiting, reason: "pool_waiting" } };

        const dbCheck = withTimeout(
            prismaPrimary.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
            3000,
            false
        );
        const redisCheck = withTimeout(
            (async () => {
                try {
                    // active ping more reliable than status==="ready" when enableReadyCheck:false (RedisClient.ts:35)
                    const res = await redisClient.ping();
                    return res === "PONG" || redisClient.status === "ready";
                } catch {
                    return false;
                }
            })(),
            3000,
            false
        );

        const [dbOk, redisOk] = await Promise.all([dbCheck, redisCheck]);
        const healthy = dbOk && redisOk && waiting === 0;
        return { healthy, checks: { db: dbOk, redis: redisOk, poolWaiting: waiting, isShuttingDown } };
    }
);

server.start();
metricsService.activeWorkers.inc();

async function startWorker(): Promise<void> {
    Logger.info(`Cron Worker (Subscription Sweeper) initializing. Check interval: ${config.CRON_CHECK_INTERVAL_MS}ms.`);

    while (!isShuttingDown) {
        try {
            currentJob = sweeper.processExpiredSubscriptions();
            const processedCount = await currentJob;
            currentJob = null;
            lastSuccess = Date.now();

            if (processedCount > 0) {
                metricsService.loopIterationsTotal.inc({ result: "success" });
                Logger.info(`Sweeper processed ${processedCount} records. Checking for more in ${BATCH_COOLDOWN_MS}ms...`);
                await abortableSleep(BATCH_COOLDOWN_MS, abort.signal);
            } else {
                metricsService.loopIterationsTotal.inc({ result: "empty" });
                const sleepMs = jitter(config.CRON_CHECK_INTERVAL_MS);
                try { metricsService.jitterSeconds.observe(sleepMs / 1000); } catch {}
                Logger.info(`No expired subscriptions found. Sleeping for ${Math.round(sleepMs / 1000)}s.`);
                await abortableSleep(sleepMs, abort.signal);
                await updateSubscriptionStatusGauges();
            }
        } catch (error) {
            currentJob = null;
            metricsService.loopIterationsTotal.inc({ result: "error" });
            Logger.error("Critical error in Cron loop", error);
            metricsService.jobErrors.inc({ job_type: "cron_loop", error_type: "critical" });
            await abortableSleep(ERROR_COOLDOWN_MS, abort.signal);
        }
    }
}

const loopDone = startWorker();
loopDone.catch(error => {
    try { metricsService.activeWorkers.dec(); } catch {}
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
        const raced = await Promise.race([
            currentJob.catch(() => {}).then(() => "done" as const),
            new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), SHUTDOWN_GRACE_MS)),
        ]);
        if (raced === "timeout") {
            try { metricsService.shutdownAbortsTotal.inc({ reason: "job_grace_timeout" }); } catch {}
        }
    }

    const loopRaced = await Promise.race([
        loopDone.catch(() => {}).then(() => "done" as const),
        new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), SHUTDOWN_GRACE_MS)),
    ]);
    if (loopRaced === "timeout") {
        try { metricsService.shutdownAbortsTotal.inc({ reason: "job_grace_timeout" }); } catch {}
    }

    metricsService.activeWorkers.dec();

    await prisma.$disconnect();
    await redisClient.quit();

    Logger.info("Cron Worker exited gracefully");
    process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
