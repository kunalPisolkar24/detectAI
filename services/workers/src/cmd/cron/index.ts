import { initTracing } from "@shared/tracing/instrumentation";
initTracing("worker-cron");

import { SubscriptionSweeper } from "@modules/cron/application/services/SubscriptionSweeper";
import { prismaPrimary, getPgPool, closePrisma } from "@shared/database/PrismaService";
import { prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { Logger } from "@shared/logging/Logger";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/infrastructure/WorkerServer";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
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
    password: (config as any).REDIS_PASSWORD,
});

const metricsService = new MetricsService("worker-cron");
try {
    const primaryPool = getPgPool("primary");
    if (primaryPool) metricsService.registerPool("primary", primaryPool);
    const replicaPool = getPgPool("replica");
    if (replicaPool && replicaPool !== primaryPool) metricsService.registerPool("replica", replicaPool);
} catch {}
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
const bootTime = Date.now();
let loopStarted = false;
const abort = new AbortController();

function jitter(intervalMs: number): number {
    return Math.round(intervalMs * (0.9 + Math.random() * 0.2));
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) return resolve();
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
    // Prevent unhandled rejection on the losing promise
    promise.catch(() => {});
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
        // Zero out synthetic NULL if no longer present to avoid stale series
        if (!seen.has(null as any) && groups.every(g => g.status !== null)) {
            metricsService.subscriptionStatus.set({ status: "NULL" }, 0);
        }
    } catch {
        // best-effort; groupBy may fail if replica not ready — ignore for loop liveness
    }
}

const server = new WorkerServer(
    metricsService,
    config.PORT || 7777,
    () => {
        // Liveness: process alive, not shutting down. Do NOT check downstream or lastSuccess.
        if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true, reason: "shutting_down" } };
        // If loop never started within 60s, liveness fails (startup hang)
        if (!loopStarted && Date.now() - bootTime > 60000) {
            return { healthy: false, checks: { loopStarted, bootAgeMs: Date.now() - bootTime, reason: "loop_not_started" } };
        }
        return { healthy: true, checks: { isShuttingDown, loopStarted } };
    },
    async () => {
        if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true, reason: "shutting_down" } };
        const pool = getPgPool("primary");
        const waiting = pool ? pool.waitingCount : 0;
        const poolPressured = waiting > 5;

        const age = Date.now() - lastSuccess;
        const threshold = 2 * config.CRON_CHECK_INTERVAL_MS;
        const loopStale = age > threshold;

        const dbCheck = withTimeout(
            prismaPrimary.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
            3000,
            false
        );
        const redisCheck = withTimeout(
            (async () => {
                try {
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
        const healthy = dbOk && redisOk && !poolPressured && !loopStale;
        return { healthy, checks: { db: dbOk, redis: redisOk, poolWaiting: waiting, poolPressured, lastSuccessAgeMs: age, thresholdMs: threshold, loopStale, isShuttingDown } };
    }
);

// Bootstrap: wait for deps before starting server and loop
async function bootstrap(): Promise<void> {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            await withTimeout(prismaPrimary.$queryRaw`SELECT 1`, 3000, null as any);
            await withTimeout(redisClient.ping(), 3000, null as any);
            break;
        } catch (e) {
            Logger.warn(`Cron bootstrap waiting for deps (attempt ${attempt}/5)`, { error: e });
            if (attempt < 5) await new Promise(r => setTimeout(r, 2000));
        }
    }
    server.start();
    metricsService.activeWorkers.inc();
    loopStarted = true;
    const loopDone = startWorker();
    loopDone.catch(error => {
        try { metricsService.activeWorkers.dec(); } catch {}
        Logger.error("Cron worker crashed during startup or execution", error);
        process.exit(1);
    });
    // Store for shutdown
    (globalThis as any).__cronLoopDone = loopDone;
}

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

// Kick off bootstrap
bootstrap().catch((err) => {
    Logger.error("Cron bootstrap failed", err);
    process.exit(1);
});

const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    Logger.info("Shutting down Cron Worker...");
    try { server.stop(); } catch {}
    abort.abort();

    const loopDone: Promise<void> = (globalThis as any).__cronLoopDone;
    // Total shutdown budget is SHUTDOWN_GRACE_MS (10s) — not 20s sequential
    const budgetEnd = Date.now() + SHUTDOWN_GRACE_MS;

    if (currentJob) {
        const remaining = Math.max(0, budgetEnd - Date.now());
        const raced = await Promise.race([
            currentJob.catch(() => {}).then(() => "done" as const),
            new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), remaining)),
        ]);
        if (raced === "timeout") {
            try { metricsService.shutdownAbortsTotal.inc({ reason: "job_grace_timeout" }); } catch {}
        }
    }

    if (loopDone) {
        const remaining = Math.max(0, budgetEnd - Date.now());
        const loopRaced = await Promise.race([
            loopDone.catch(() => {}).then(() => "done" as const),
            new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), remaining)),
        ]);
        if (loopRaced === "timeout") {
            try { metricsService.shutdownAbortsTotal.inc({ reason: "loop_grace_timeout" }); } catch {}
        }
    }

    try { metricsService.activeWorkers.dec(); } catch {}

    try { await closePrisma(); } catch (e: any) { Logger.warn("Prisma close error", { error: e instanceof Error ? e.message : String(e) }); }
    try {
        await Promise.race([redisClient.quit(), new Promise((_, rej) => setTimeout(() => rej(new Error("redis quit timeout")), 3000))]);
    } catch {}

    Logger.info("Cron Worker exited gracefully");
    process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("SIGQUIT", shutdown);
process.on("unhandledRejection", (reason: any) => Logger.error("Unhandled rejection in cron worker", reason));
process.on("uncaughtException", (err: any) => Logger.error("Uncaught exception in cron worker", err));
