import { afterAll, beforeEach } from "bun:test";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { RabbitMQContainer, type StartedRabbitMQContainer } from "@testcontainers/rabbitmq";
import { execSync } from "node:child_process";
import { Pool } from "pg";

console.log("Starting integration test infrastructure...");

const postgresPromise = new GenericContainer("postgres:16-alpine")
    .withEnvironment({
        POSTGRES_DB: "detectai_test",
        POSTGRES_USER: "test",
        POSTGRES_PASSWORD: "test",
    })
    .withExposedPorts(5432)
    .start();

const redisPromise = new RedisContainer("redis:7-alpine").start();
const rabbitmqPromise = new RabbitMQContainer("rabbitmq:3-management-alpine").start();

const [postgres, redis, rabbitmq] = await Promise.all([
    postgresPromise,
    redisPromise,
    rabbitmqPromise
]);

console.log("Infrastructure started successfully");

const dbUrl = `postgresql://test:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/detectai_test`;
const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
const amqpUrl = rabbitmq.getAmqpUrl();

process.env.DATABASE_URL = dbUrl;
process.env.DATABASE_URL_REPLICA = dbUrl;
process.env.REDIS_URL = redisUrl;
process.env.RABBITMQ_URL = amqpUrl;
process.env.NODE_ENV = "test";

console.log(`Running prisma db push...`);
execSync("bunx prisma db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "inherit",
});
console.log("Prisma db push complete");

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

    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
        const Redis = (await import("ioredis")).default;
        const redisClient = new Redis(redisUrl);
        await redisClient.flushall();
        await redisClient.quit();
    }
}, 30000);

afterAll(async () => {
    await Promise.all([
        postgres.stop(),
        redis.stop(),
        rabbitmq.stop()
    ]);
});
