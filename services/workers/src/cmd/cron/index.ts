import { SubscriptionSweeper } from "@modules/cron/application/services/SubscriptionSweeper";
import { prisma, prismaPrimary, getPgPool } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { Logger } from "@shared/logging/Logger";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/infrastructure/WorkerServer";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { config } from "./config";

const CHECK_INTERVAL_MS = 1000 * 60 * 60;
const BATCH_COOLDOWN_MS = 5000;
const ERROR_COOLDOWN_MS = 60000;

const redisClient = RedisFactory.createClient({
    mode: config.REDIS_MODE,
    name: "CronRedis",
    url: config.REDIS_URL,
    sentinels: config.REDIS_SENTINELS,
    masterName: config.REDIS_MASTER_NAME,
    password: process.env.REDIS_PASSWORD,
});

const metricsService = new MetricsService("worker-cron");
metricsService.registerPool("primary", getPgPool("primary")!);
metricsService.registerPool("replica", getPgPool("replica")!);

redisClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 1));
redisClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 1));
redisClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 0));
redisClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "CronRedis" }, 0));

const userRepository = new PrismaUserRepository(prismaPrimary, prisma);
const sweeper = new SubscriptionSweeper(userRepository, redisClient, metricsService);

const server = new WorkerServer(
    metricsService,
    config.PORT || 7777,
    () => true,
    () => redisClient.status === "ready"
);

server.start();

let isShuttingDown = false;

async function startWorker() {
    Logger.info("Cron Worker (Subscription Sweeper) initializing...");
    metricsService.activeWorkers.inc();
    await new Promise(resolve => setTimeout(resolve, 2000));

    Logger.info("Initialization complete. Running immediate startup sweep.");

    while (!isShuttingDown) {
        try {
            const processedCount = await sweeper.processExpiredSubscriptions();
            
            if (processedCount > 0) {
                Logger.info(`Sweeper processed ${processedCount} records. Checking for more in ${BATCH_COOLDOWN_MS}ms...`);
                await new Promise(resolve => setTimeout(resolve, BATCH_COOLDOWN_MS));
            } else {
                Logger.info(`No expired subscriptions found. Sleeping for ${CHECK_INTERVAL_MS / 1000 / 60} minutes.`);
                await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
            }

        } catch (error) {
            Logger.error("Critical error in Cron loop", error);
            metricsService.jobErrors.inc({ job_type: "cron_loop", error_type: "critical" });
            await new Promise(resolve => setTimeout(resolve, ERROR_COOLDOWN_MS));
        }
    }
}

startWorker();

const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    server.stop();
    metricsService.activeWorkers.dec();
    
    Logger.info("Shutting down Cron Worker...");
    
    await prisma.$disconnect();
    await redisClient.quit();
    
    Logger.info("Cron Worker exited gracefully");
    process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
