import { Logger } from "@shared/logging/Logger";
import { WorkerServer } from "@shared/http/WorkerServer";
import type { MetricsService } from "@shared/monitoring/MetricsService";
import { withTimeout } from "@shared/utils/withTimeout";
import { closePrisma, getPgPool } from "@shared/database/PrismaService";
import type { RedisClient } from "@shared/cache/RedisClient";

export async function probeDependencies(probes: Array<{ name: string; check: () => Promise<unknown> }>, attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await Promise.all(probes.map((p) => withTimeout(p.check(), 3000, null as any)));
      return;
    } catch (e) {
      Logger.warn(`Bootstrap waiting for deps (attempt ${attempt}/${attempts})`, { error: e });
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export function wireShutdown(opts: {
  metrics: MetricsService;
  server: WorkerServer;
  redisClients: RedisClient[];
  worker?: { shutdown: () => Promise<void> };
  extra?: () => Promise<void>;
}): () => Promise<void> {
  let shuttingDown = false;
  return async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      opts.metrics.activeWorkers.dec();
    } catch {}
    try {
      opts.server.stop();
    } catch {}
    if (opts.worker) {
      try {
        await Promise.race([opts.worker.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10000))]);
      } catch (e: any) {
        Logger.warn("Worker shutdown error", { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (opts.extra) {
      try {
        await opts.extra();
      } catch {}
    }
    try {
      await closePrisma();
    } catch (e: any) {
      Logger.warn("Prisma close error", { error: e instanceof Error ? e.message : String(e) });
    }
    for (const client of opts.redisClients) {
      try {
        await Promise.race([client.quit(), new Promise((_, rej) => setTimeout(() => rej(new Error("quit timeout")), 5000))]);
      } catch {}
    }
    process.exit(0);
  };
}

export function setupSignalHandlers(shutdown: () => Promise<void>): void {
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGQUIT", shutdown);
  process.on("unhandledRejection", (reason: any) => Logger.error("Unhandled rejection", reason));
  process.on("uncaughtException", (err: any) => Logger.error("Uncaught exception", err));
}

export function isPoolPressured(threshold = 5): boolean {
  const pool = getPgPool("primary");
  return pool ? pool.waitingCount > threshold : false;
}
export function getPoolWaiting(): number {
  const pool = getPgPool("primary");
  return pool ? pool.waitingCount : 0;
}
