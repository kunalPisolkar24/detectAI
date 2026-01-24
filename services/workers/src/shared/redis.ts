import Redis, { Cluster, type ClusterNode, type RedisOptions } from "ioredis";
import { Logger } from "./logger";

const defaultRedisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const createRedisClient = (url: string, name: string = "Redis"): Redis => {
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

export const createClusterClient = (connectionString: string, name: string = "RedisCluster"): Cluster => {
    const nodes: ClusterNode[] = connectionString.split(",").map((url) => {
        const cleanUrl = url.replace("redis://", "");
        const [host, port] = cleanUrl.split(":");
        return {
            host,
            port: parseInt(port || "6379", 10),
        };
    });

    const cluster = new Redis.Cluster(nodes, {
        redisOptions: {
            password: process.env.REDIS_PASSWORD,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        } as RedisOptions,
        retryDelayOnFailover: 100,
        slotsRefreshTimeout: 2000,
        scaleReads: "slave",
    });

    cluster.on("error", (error) => {
        Logger.error(`${name} cluster error`, error);
    });

    cluster.on("connect", () => {
        Logger.info(`${name} connected successfully`);
    });

    return cluster;
};

export const redis = createRedisClient(defaultRedisUrl, "MainRedis");