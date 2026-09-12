import { execSync } from "node:child_process";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { startRabbitCluster, type RabbitCluster } from "./containers-rabbitmq-cluster";

export interface HaInfra {
  pg: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  eventRedis: StartedRedisContainer | null;
  rabbit: RabbitCluster;
  databaseUrl: string;
  redisUrl: string;
  eventRedisUrl: string | null;
  rabbitUrl: string;
  cleanup(): Promise<void>;
}

async function waitForPg(url: string, timeoutMs = 10_000): Promise<void> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

/**
 * Fully self-contained HA infra: pg + redis (+event redis for payments) +
 * 3-node RabbitMQ cluster. No localhost assumption, no Compose, no Floci.
 * Runs `prisma db push` against the fresh pg so handler DB writes work.
 */
export async function startHaInfra(opts: { withEventRedis: boolean }): Promise<HaInfra> {
  console.log("[ha-infra] resetting prisma pools");
  // Reset any prior prisma pools so new DATABASE_URL takes effect (HA suites share process).
  try {
    const { closePrisma } = await import("@shared/database/PrismaService");
    await closePrisma().catch(() => {});
  } catch (e) {
    console.log("[ha-infra] closePrisma failed", e);
  }
  console.log("[ha-infra] starting postgres");
  const pg = await new PostgreSqlContainer("postgres:15-alpine")
    .withDatabase("detectai_ha_test")
    .withUsername("user")
    .withPassword("password")
    .start();

  const databaseUrl = pg.getConnectionUri();
  console.log("[ha-infra] pg started", databaseUrl);
  // testcontainers already waits for PG ready; quick probe instead of 60s loop
  try {
    await waitForPg(databaseUrl, 10_000);
  } catch (e) {
    console.log("[ha-infra] waitForPg failed, continuing anyway", e);
  }
  console.log("[ha-infra] pg ready");

  const redis = await new RedisContainer("redis:7.2-alpine").start();
  // StartedRedisContainer.getConnectionUrl() has no auth by default; plain host:port is enough.
  const redisHost = redis.getHost();
  const redisPort = redis.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  console.log("[ha-infra] redis started", redisUrl);

  let eventRedis: StartedRedisContainer | null = null;
  let eventRedisUrl: string | null = null;
  if (opts.withEventRedis) {
    console.log("[ha-infra] starting event redis");
    eventRedis = await new RedisContainer("redis:7.2-alpine").start();
    eventRedisUrl = `redis://${eventRedis.getHost()}:${eventRedis.getPort()}`;
    console.log("[ha-infra] event redis started", eventRedisUrl);
  }

  console.log("[ha-infra] starting rabbit cluster");
  const rabbit = await startRabbitCluster("guest", "guest");
  const rabbitUrl = rabbit.primaryUrl();
  console.log("[ha-infra] rabbit ready", rabbitUrl);

  // Point app code at HA infra and push schema.
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_URL_REPLICA = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  if (eventRedisUrl) process.env.EVENT_REDIS_URL = eventRedisUrl;
  process.env.RABBITMQ_URL = rabbitUrl;
  process.env.ENV_TYPE = "dev";
  process.env.PADDLE_API_KEY = "test-paddle-key";
  process.env.PADDLE_ENVIRONMENT = "sandbox";
  process.env.INFRA_REQUEUE_DELAY_MS = "0";

  console.log("[ha-infra] running prisma db push");
  execSync("bunx prisma db push --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
  console.log("[ha-infra] prisma push done");

  return {
    pg,
    redis,
    eventRedis,
    rabbit,
    databaseUrl,
    redisUrl,
    eventRedisUrl,
    rabbitUrl,
    async cleanup() {
      await rabbit.cleanup().catch(() => {});
      if (eventRedis) await eventRedis.stop().catch(() => {});
      await redis.stop().catch(() => {});
      await pg.stop().catch(() => {});
    },
  };
}

export async function truncateHaDb(databaseUrl: string): Promise<void> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    for (const table of ["User", "Subscription", "Usage", "Account", "Session", "VerificationToken", "ProcessedWebhook"]) {
      await client.query(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

export async function flushHaRedis(redisUrl: string): Promise<void> {
  const Redis = (await import("ioredis")).default;
  const client = new Redis(redisUrl);
  try {
    await client.flushall();
  } finally {
    await client.quit().catch(() => {});
  }
}
