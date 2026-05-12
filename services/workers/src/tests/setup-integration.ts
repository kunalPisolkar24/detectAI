import { beforeAll, afterAll, beforeEach } from "bun:test";
import { GenericContainer, type StartedGenericContainer } from "testcontainers";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { RabbitMQContainer, type StartedRabbitMQContainer } from "@testcontainers/rabbitmq";
import { execSync } from "node:child_process";
import { Pool } from "pg";

let postgres: StartedGenericContainer;
let redis: StartedRedisContainer;
let rabbitmq: StartedRabbitMQContainer;

beforeAll(async () => {
    console.log("Starting containers...");
    postgres = await new GenericContainer("postgres:16-alpine")
        .withEnvironment({
            POSTGRES_DB: "detectai_test",
            POSTGRES_USER: "test",
            POSTGRES_PASSWORD: "test",
        })
        .withExposedPorts(5432)
        .start();
    console.log("Postgres started");

    // redis = await new RedisContainer("redis:7-alpine").start();
    // console.log("Redis started");

    // rabbitmq = await new RabbitMQContainer("rabbitmq:3-management-alpine").start();
    // console.log("RabbitMQ started");

    const dbUrl = `postgresql://test:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/detectai_test`;
    // const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    // const amqpUrl = rabbitmq.getAmqpUrl();

    process.env.DATABASE_URL = dbUrl;
    process.env.DATABASE_URL_REPLICA = dbUrl;
    // process.env.REDIS_URL = redisUrl;
    // process.env.RABBITMQ_URL = amqpUrl;
    process.env.NODE_ENV = "test";


    console.log(`Running prisma db push with URL: ${dbUrl}`);
    try {
        execSync("bunx prisma db push --skip-generate", {
            env: { ...process.env, DATABASE_URL: dbUrl },
            stdio: "inherit",
        });
    } catch (error) {
        console.error("Prisma db push failed:", error);
        throw error;
    }
    console.log("Prisma db push complete");
}, 180000);



beforeEach(async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return;

    console.log("Resetting database...");
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
    // const redisUrl = process.env.REDIS_URL;
    // if (redisUrl) {
    //     const Redis = (await import("ioredis")).default;
    //     const redisClient = new Redis(redisUrl);
    //     await redisClient.flushall();
    //     await redisClient.quit();
    // }
    console.log("Reset complete");
}, 30000);


afterAll(async () => {
    if (postgres) await postgres.stop();
    if (redis) await redis.stop();
    if (rabbitmq) await rabbitmq.stop();
});

