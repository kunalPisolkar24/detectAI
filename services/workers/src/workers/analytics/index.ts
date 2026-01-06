import { AnalyticsService } from "./services/AnalyticsService";
import { prisma } from "@shared/db";
import { Logger } from "@shared/logger";

const FLUSH_INTERVAL_MS = 5000;

const analyticsService = new AnalyticsService();
let isShuttingDown = false;

async function startWorker() {
    Logger.info("Analytics Worker started");

    while (!isShuttingDown) {
        const startTime = Date.now();
        
        try {
            const processedCount = await analyticsService.processBatch();
            
            const duration = Date.now() - startTime;
            const timeToWait = Math.max(0, FLUSH_INTERVAL_MS - duration);
            
            if (processedCount > 0) {
                Logger.info(`Processed ${processedCount} records in ${duration}ms`);
            }

            await new Promise(resolve => setTimeout(resolve, timeToWait));

        } catch (error) {
            Logger.error("Critical error in analytics loop", error);
            await new Promise(resolve => setTimeout(resolve, FLUSH_INTERVAL_MS));
        }
    }
}

startWorker();

const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    Logger.info("Shutting down Analytics Worker...");
    
    await analyticsService.shutdown();
    await prisma.$disconnect();
    
    Logger.info("Analytics Worker exited gracefully");
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);