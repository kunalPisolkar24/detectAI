import { beforeAll, afterAll, beforeEach } from "bun:test";
import { execSync } from "node:child_process";
import { Pool } from "pg";

let initPromise: Promise<void> | null = null;

async function ensureInfrastructure() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        console.log("Starting integration test infrastructure (using local dev containers)...");
        try {
            const dbUrl = `postgresql://user:password@localhost:5432/detectai_test`;
            // Use DB index 1 to avoid clearing dev cache
            const redisUrl = `redis://:user_cache_password@localhost:6379/1`;
            const amqpUrl = `amqp://guest:guest@localhost:5672/detectai_test`;

            process.env.DATABASE_URL = dbUrl;
            process.env.DATABASE_URL_REPLICA = dbUrl;
            process.env.REDIS_URL = redisUrl;
            process.env.RABBITMQ_URL = amqpUrl;
            process.env.NODE_ENV = "test";

            console.log(`Running prisma db push... URL: ${dbUrl}`);
            execSync("bunx prisma db push", {
                env: { ...process.env, DATABASE_URL: dbUrl },
                stdio: "inherit",
            });
            console.log("Prisma db push complete");
        } catch (error) {
            console.error("Failed to start infrastructure:", error);
            initPromise = null; // Allow retry
            throw error;
        }
    })();

    return initPromise;
}

beforeAll(async () => {
    await ensureInfrastructure();
}, 300000); // 5 minutes


beforeEach(async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return;

    console.log("Cleaning up database...");
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
    console.log("Database clean");

    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
        console.log("Flushing Redis...");
        const Redis = (await import("ioredis")).default;
        const redisClient = new Redis(redisUrl);
        await redisClient.flushall();
        await redisClient.quit();
        console.log("Redis flushed");
    }
}, 30000);

// We don't stop containers between files in bun test if we want them to persist
// But bun test doesn't have a global afterAll easily.
// Testcontainers will clean up via Ryuk anyway.
/*
afterAll(async () => {
    if (postgres) await postgres.stop();
    if (redis) await redis.stop();
    if (rabbitmq) await rabbitmq.stop();
});
*/
