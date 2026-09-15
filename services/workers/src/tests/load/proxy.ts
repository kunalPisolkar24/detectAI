import { serve } from "bun";
import amqp, { type Channel, type ChannelModel } from "amqplib";
import { prismaPrimary as prisma } from "@shared/database/PrismaService";
import { Logger } from "@shared/logging/Logger";

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const PORT = parseInt(process.env.PROXY_PORT || "9999", 10) || 9999;
const MOCK_MODE = process.env.MOCK_MODE === "true";
// Cron rig has no broker (seed-only): REQUIRE_BROKER=0 drops the AMQP
// requirement from /health and skips connecting altogether.
const REQUIRE_BROKER = process.env.REQUIRE_BROKER !== "0";

// Connections
let amqpConn: ChannelModel | null = null;
let amqpChannel: Channel | null = null;

async function initAmqp() {
    if (MOCK_MODE) {
        Logger.info("Proxy running in MOCK_MODE (No real infrastructure connections)");
        return;
    }
    if (!REQUIRE_BROKER) {
        Logger.info("Proxy running without broker (REQUIRE_BROKER=0, seed-only)");
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

        if (req.method === "GET" && url.pathname === "/health") {
            let dbOk = true;
            try {
                await prisma.$queryRaw`SELECT 1`;
            } catch {
                dbOk = false;
            }
            const amqpOk = MOCK_MODE || !REQUIRE_BROKER || !!amqpChannel;
            const ok = dbOk && amqpOk;
            return Response.json(
                { status: ok ? "ok" : "degraded", mock: MOCK_MODE, db: dbOk, amqp: amqpOk },
                { status: ok ? 200 : 503 },
            );
        }

        if (req.method === "POST" && url.pathname === "/payments") {
            try {
                const body = (await req.json()) as any;
                // Paddle-shaped payload (matches what the handlers parse):
                // stable sub id per user so repeats form a valid lifecycle
                // (created -> updated* -> canceled -> created ...) instead of
                // poison-transition DLQs. Explicit body.data fields win.
                const eventType = body.event_type || "subscription.updated";
                const userId = body.userId || `user_${Math.floor(Math.random() * 10000)}`;
                const now = new Date().toISOString();
                const payload = {
                    event_type: eventType,
                    event_id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    occurred_at: now,
                    data: {
                        id: `sub_${userId}`,
                        status: eventType === "subscription.canceled" ? "canceled" : "active",
                        customer_id: `ctm_${userId}`,
                        custom_data: { userId },
                        items: [{ price: { id: "pro_monthly" } }],
                        current_billing_period: {
                            ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                        },
                        canceled_at: eventType === "subscription.canceled" ? now : undefined,
                        occurred_at: now,
                        ...body.data
                    }
                };

                if (MOCK_MODE) {
                    Logger.info(`[MOCK] Payments event: ${payload.event_type} for ${userId}`);
                } else {
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

                    // Contract v1: eventId (idempotency key) + event_type required.
                    const eventId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    if (amqpChannel) {
                        amqpChannel.sendToQueue("analytics.usage", Buffer.from(JSON.stringify({ event_type: "usage_event", eventId, userId, count, timestamp: new Date().toISOString() })), { persistent: true });
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
