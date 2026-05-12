import { beforeAll, afterAll, beforeEach } from "bun:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { RabbitMQContainer, type StartedRabbitMQContainer } from "@testcontainers/rabbitmq";
import { execSync } from "node:child_process";
import { Pool } from "pg";

let postgres: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;
let rabbitmq: StartedRabbitMQContainer;

beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("detectai_test")
        .withUsername("test")
        .withPassword("test")
        .start();

    redis = await new RedisContainer("redis:7-alpine").start();

    rabbitmq = await new RabbitMQContainer("rabbitmq:3-management-alpine").start();

    const dbUrl = postgres.getConnectionUri();
    const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    const amqpUrl = rabbitmq.getAmqpUrl();

    process.env.DATABASE_URL = dbUrl;
    process.env.DATABASE_URL_REPLICA = dbUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.RABBITMQ_URL = amqpUrl;
    process.env.NODE_ENV = "test";

    execSync("bunx prisma db push --skip-generate", {
        env: { ...process.env, DATABASE_URL: dbUrl },
    });
}, 60000);

beforeEach(async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return;

    const pool = new Pool({ connectionString: dbUrl });
    const client = await pool.connect();
    try {
        const tables = ["User", "Subscription", "Usage", "Account", "Session", "VerificationToken"];
        for (const table of tables) {
            await client.query(`TRUNCATE TABLE "${table}" CASCADE;`);
        }
    } finally {
        client.release();
        await pool.end();
    }

    // Redis flush
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
        const Redis = (await import("ioredis")).default;
        const redisClient = new Redis(redisUrl);
        await redisClient.flushall();
        await redisClient.quit();
    }
});

afterAll(async () => {
    if (postgres) await postgres.stop();
    if (redis) await redis.stop();
    if (rabbitmq) await rabbitmq.stop();
});

