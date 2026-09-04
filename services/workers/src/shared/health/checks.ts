import { prismaPrimary, getPgPool } from "@shared/database/PrismaService";
import { withTimeout } from "@shared/utils/withTimeout";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { type RedisClient } from "@shared/cache/RedisClient";

export function isPoolPressured(threshold = 5): boolean {
    const pool = getPgPool("primary");
    const waiting = pool ? pool.waitingCount : 0;
    return waiting > threshold;
}

export function getPoolWaiting(): number {
    const pool = getPgPool("primary");
    return pool ? pool.waitingCount : 0;
}

export async function checkDb(): Promise<boolean> {
    return withTimeout(
        prismaPrimary.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
        3000,
        false
    );
}

export async function checkRedis(client: RedisClient): Promise<boolean> {
    return withTimeout(
        (async () => {
            try {
                const res = await client.ping();
                return res === "PONG" || client.status === "ready";
            } catch {
                return false;
            }
        })(),
        3000,
        false
    );
}

export function wireRedisMetrics(client: RedisClient, metrics: MetricsService, name: string): void {
    client.on("connect", () => metrics.redisConnectionStatus.set({ client_name: name }, 1));
    client.on("ready", () => metrics.redisConnectionStatus.set({ client_name: name }, 1));
    client.on("close", () => metrics.redisConnectionStatus.set({ client_name: name }, 0));
    client.on("error", () => metrics.redisConnectionStatus.set({ client_name: name }, 0));
}

export function registerPools(metrics: MetricsService): void {
    try {
        const primaryPool = getPgPool("primary");
        if (primaryPool) metrics.registerPool("primary", primaryPool);
        const replicaPool = getPgPool("replica");
        if (replicaPool && replicaPool !== primaryPool) metrics.registerPool("replica", replicaPool);
    } catch {}
}
