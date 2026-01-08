import Redis from "ioredis";
import { Logger } from "./logger";

const defaultRedisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const createRedisClient = (url: string, name: string = "Redis") => {
    const client = new Redis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy(times) {
            return Math.min(times * 50, 2000);
        },
    });

    client.on("error", (error) => {
        Logger.error(`${name} connection error`, error);
    });

    client.on("connect", () => {
        Logger.info(`${name} connected successfully`);
    });

    return client;
};

export const redis = createRedisClient(defaultRedisUrl, "MainRedis");