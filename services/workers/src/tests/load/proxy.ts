import { serve } from "bun";
import amqp, { type Channel, type ConsumeMessage, type ChannelModel } from "amqplib";
import { RedisFactory } from "@shared/cache/RedisClient";
import { prismaPrimary as prisma } from "@shared/database/PrismaService";
import { Logger } from "@shared/logging/Logger";

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const REDIS_USAGE_URL = process.env.REDIS_USAGE_URL || "redis://localhost:6382";
const REDIS_MODE = (process.env.REDIS_MODE as any) || "standalone";
const PORT = 9999;
const MOCK_MODE = process.env.MOCK_MODE === "true";

// Connections
let amqpConn: ChannelModel | null = null;
let amqpChannel: Channel | null = null;

const redisClient = MOCK_MODE ? null : RedisFactory.createClient({
    mode: REDIS_MODE,
    name: "LoadProxyRedis",
    url: REDIS_URL,
    sentinels: process.env.REDIS_SENTINELS ? JSON.parse(process.env.REDIS_SENTINELS) : undefined,
    masterName: process.env.REDIS_MASTER_NAME,
    password: process.env.REDIS_PASSWORD,
});

const usageRedisClient = MOCK_MODE ? null : RedisFactory.createClient({
    mode: REDIS_MODE,
    name: "LoadProxyUsageRedis",
    url: REDIS_USAGE_URL,
    password: process.env.REDIS_USAGE_PASSWORD || "usage_cache_password",
});

async function initAmqp() {
    if (MOCK_MODE) {
        Logger.info("Proxy running in MOCK_MODE (No real infrastructure connections)");
        return;
    }
    try {
        amqpConn = await amqp.connect(RABBITMQ_URL);
        amqpChannel = await amqpConn.createChannel();
        Logger.info("Connected to RabbitMQ for load testing");
    } catch (error) {
        Logger.error("Failed to connect to RabbitMQ", error);
    }
}

initAmqp();

const server = serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "POST" && url.pathname === "/payments") {
            try {
                const body = (await req.json()) as any;
                const payload = {
                    event_type: body.event_type || "subscription.updated",
                    data: {
                        custom_data: { userId: body.userId || `user_${Math.floor(Math.random() * 10000)}` },
                        paddleCustomerId: `ctm_${Math.random().toString(36).substring(7)}`,
                        paddleSubscriptionId: `sub_${Math.random().toString(36).substring(7)}`,
                        paddlePlanId: "pro_monthly",
                        status: "active",
                        endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                        ...body.data
                    }
                };

                if (MOCK_MODE) {
                    Logger.info(`[MOCK] Payments event: ${payload.event_type} for ${payload.data.custom_data.userId}`);
                } else {
                    const userId = payload.data.custom_data.userId;
                    // Ensure user exists so the worker can actually update something
                    await prisma.user.upsert({
                        where: { id: userId },
                        create: { 
                            id: userId, 
                            email: `${userId}@example.com`,
                            name: "Load Test User"
                        },
                        update: {}
                    });

                    if (amqpChannel) {
                        amqpChannel.sendToQueue("payment_events", Buffer.from(JSON.stringify(payload)), { persistent: true });
                    }
                }
                return new Response(JSON.stringify({ success: true }), { status: 200 });
            } catch (error) {
                return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
            }
        }

        if (req.method === "POST" && url.pathname === "/analytics") {
            try {
                const body = (await req.json()) as any;
                const userId = body.userId || `user_${Math.floor(Math.random() * 10000)}`;
                const count = body.count || 1;

                if (MOCK_MODE) {
                    Logger.info(`[MOCK] Analytics usage: ${userId} +${count}`);
                } else {
                    // Ensure user exists so the worker can successfully flush usage to DB
                    await prisma.user.upsert({
                        where: { id: userId },
                        create: { 
                            id: userId, 
                            email: `${userId}@example.com`,
                            name: "Analytics Test User"
                        },
                        update: {}
                    });

                    if (usageRedisClient) {
                        await usageRedisClient.sadd("usage:dirty_users", userId);
                        await usageRedisClient.incrby(`usage:{${userId}}:pending`, count);
                    }
                }

                return new Response(JSON.stringify({ success: true }), { status: 200 });
            } catch (error) {
                return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
            }
        }

        if (req.method === "POST" && url.pathname === "/cron/seed") {
            try {
                const body = (await req.json()) as any;
                const count = body.count || 100;
                
                const now = new Date();
                const expiredDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago

                const users = Array.from({ length: count }).map((_, i) => ({
                    id: `load_test_user_${Date.now()}_${i}`,
                    email: `load_test_${Date.now()}_${i}@example.com`,
                    name: `Load Test User ${i}`,
                }));

                if (MOCK_MODE) {
                    Logger.info(`[MOCK] Seeding ${count} users`);
                } else {
                    await prisma.user.createMany({ data: users });

                    const subscriptions = users.map(user => ({
                        userId: user.id,
                        paddleSubscriptionId: `sub_load_${user.id}`,
                        paddlePlanId: "pro_monthly",
                        status: "ACTIVE" as any,
                        endsAt: expiredDate,
                    }));

                    await prisma.subscription.createMany({ data: subscriptions });
                }

                return new Response(JSON.stringify({ success: true, count }), { status: 200 });
            } catch (error) {
                return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
            }
        }

        return new Response("Not Found", { status: 404 });
    },
});

Logger.info(`Load Testing Proxy running on http://localhost:${PORT}`);
