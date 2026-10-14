import { serve } from "bun";
import amqp, { type ChannelModel, type ConfirmChannel } from "amqplib";
import { z } from "zod";
import { prismaPrimary as prisma } from "@shared/database/PrismaService";
import { Logger } from "@shared/logging/Logger";

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const PORT = parseInt(process.env.PROXY_PORT || "9999", 10) || 9999;
const MOCK_MODE = process.env.MOCK_MODE === "true";
// Cron rig has no broker (seed-only): REQUIRE_BROKER=0 drops the AMQP
// requirement from /health and skips connecting altogether.
const REQUIRE_BROKER = process.env.REQUIRE_BROKER !== "0";

const PAYMENTS_QUEUE = "payment_events";
const ANALYTICS_QUEUE = "analytics.usage";
const ALLOWED_DEPTH_QUEUES = new Set([
    PAYMENTS_QUEUE,
    ANALYTICS_QUEUE,
    `${PAYMENTS_QUEUE}_dlq`,
    `${ANALYTICS_QUEUE}_dlq`,
]);

// Connections (confirm channel so publishes are acked by the broker).
let amqpConn: ChannelModel | null = null;
let amqpChannel: ConfirmChannel | null = null;
let connecting = false;

async function initAmqp(attempt = 1): Promise<void> {
    if (MOCK_MODE || !REQUIRE_BROKER || connecting) return;
    connecting = true;
    try {
        amqpConn = await amqp.connect(RABBITMQ_URL);
        amqpConn.on("error", (err) => Logger.error("Proxy RabbitMQ connection error", err));
        amqpConn.on("close", () => {
            Logger.warn("Proxy RabbitMQ connection closed, reconnecting...");
            amqpConn = null;
            amqpChannel = null;
            connecting = false;
            setTimeout(() => initAmqp().catch(() => {}), 2000);
        });
        const ch = await amqpConn.createConfirmChannel();
        ch.on("error", (err) => Logger.error("Proxy RabbitMQ channel error", err));
        ch.on("close", () => {
            Logger.warn("Proxy RabbitMQ channel closed");
            amqpChannel = null;
        });
        amqpChannel = ch as unknown as ConfirmChannel;
        Logger.info("Connected to RabbitMQ for load testing (confirm channel)");
    } catch (error) {
        Logger.error(`Failed to connect to RabbitMQ (attempt ${attempt})`, error);
        amqpConn = null;
        amqpChannel = null;
        connecting = false;
        setTimeout(() => initAmqp(attempt + 1).catch(() => {}), Math.min(2000 * attempt, 10000));
        return;
    }
    connecting = false;
}

function randomId(): string {
    return typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function publishConfirmed(queue: string, body: string): Promise<boolean> {
    if (MOCK_MODE || !REQUIRE_BROKER) return true;
    const ch = amqpChannel;
    if (!ch) return false;
    try {
        const ok = ch.sendToQueue(queue, Buffer.from(body), { persistent: true });
        if (!ok) Logger.warn("Proxy publish buffer full, waiting for confirms", { queue });
        await ch.waitForConfirms();
        return true;
    } catch (error) {
        Logger.error("Proxy publish failed", error, { queue });
        return false;
    }
}

function json(data: unknown, status = 200): Response {
    return Response.json(data, { status });
}

function badRequest(message: string, details?: unknown): Response {
    return json({ error: message, details }, 400);
}

// Malformed JSON is a client error (400), not a server error: req.json()
// throws SyntaxError on bad input, which must not fall through to the 500 path.
async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
    try {
        return { ok: true, body: await req.json() };
    } catch {
        return { ok: false, res: badRequest("invalid JSON body") };
    }
}

const paymentsBodySchema = z.object({
    event_type: z.string().min(1).max(64).optional(),
    event_id: z.string().min(1).max(128).optional(),
    eventId: z.string().min(1).max(128).optional(),
    userId: z.string().min(1).max(64).optional(),
    ensureUser: z.boolean().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
});

const analyticsBodySchema = z.object({
    userId: z.string().min(1).max(64).optional(),
    count: z.number().int().min(1).max(1000).optional(),
    eventId: z.string().min(1).max(128).optional(),
    event_id: z.string().min(1).max(128).optional(),
    ensureUser: z.boolean().optional(),
});

const seedUsersSchema = z.object({
    run: z.string().min(1).max(64),
    count: z.number().int().min(1).max(20000),
    prefix: z.string().min(1).max(16).default("load"),
});

const cronSeedSchema = z.object({
    count: z.number().int().min(1).max(20000).optional().default(100),
    run: z.string().min(1).max(64).optional(),
});

async function checkDb(): Promise<boolean> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
    } catch {
        return false;
    }
}

initAmqp().catch(() => {});

const server = serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "GET" && url.pathname === "/health") {
            const dbOk = await checkDb();
            const amqpOk = MOCK_MODE || !REQUIRE_BROKER || !!amqpChannel;
            const ok = dbOk && amqpOk;
            return json(
                { status: ok ? "ok" : "degraded", mock: MOCK_MODE, db: dbOk, amqp: amqpOk },
                ok ? 200 : 503,
            );
        }

        if (req.method === "GET" && url.pathname === "/ready") {
            const dbOk = await checkDb();
            const amqpOk = MOCK_MODE || !REQUIRE_BROKER || !!amqpChannel;
            const ok = dbOk && amqpOk;
            return json({ status: ok ? "ready" : "not_ready", db: dbOk, amqp: amqpOk }, ok ? 200 : 503);
        }

        if (req.method === "GET" && url.pathname === "/queue-depth") {
            const queue = url.searchParams.get("queue") || "";
            if (!queue || !ALLOWED_DEPTH_QUEUES.has(queue)) {
                return badRequest("unknown queue", { allowed: [...ALLOWED_DEPTH_QUEUES] });
            }
            if (MOCK_MODE || !REQUIRE_BROKER) {
                return json({ queue, messageCount: 0, consumerCount: 0, mock: true });
            }
            if (!amqpChannel) return json({ error: "broker_unavailable", queue }, 503);
            try {
                const info = await amqpChannel.checkQueue(queue);
                return json({ queue, messageCount: info.messageCount, consumerCount: info.consumerCount });
            } catch (error) {
                return json({ error: (error as Error).message }, 500);
            }
        }

        if (req.method === "GET" && url.pathname === "/verify/payments") {
            const userId = url.searchParams.get("userId") || "";
            if (!userId) return badRequest("userId is required");
            try {
                const sub = await prisma.subscription.findUnique({ where: { userId } });
                return json({ userId, found: !!sub, status: sub?.status ?? null });
            } catch (error) {
                return json({ error: (error as Error).message }, 500);
            }
        }

        if (req.method === "GET" && url.pathname === "/verify/analytics") {
            const userId = url.searchParams.get("userId") || "";
            if (!userId) return badRequest("userId is required");
            try {
                const usage = await prisma.usage.findUnique({ where: { userId } });
                return json({
                    userId,
                    found: !!usage,
                    total: usage?.apiCallCountTotal ?? 0,
                    daily: usage?.apiCallCountDaily ?? 0,
                });
            } catch (error) {
                return json({ error: (error as Error).message }, 500);
            }
        }

        if (req.method === "GET" && url.pathname === "/verify/cron") {
            const run = url.searchParams.get("run") || "";
            if (!run) return badRequest("run is required");
            if (MOCK_MODE) return json({ run, remaining: 0, total: 0, mock: true });
            try {
                const prefix = `load_test_${run}_`;
                const [remaining, total] = await Promise.all([
                    prisma.subscription.count({
                        where: { status: "ACTIVE", endsAt: { lt: new Date() }, userId: { startsWith: prefix } },
                    }),
                    prisma.subscription.count({ where: { userId: { startsWith: prefix } } }),
                ]);
                return json({ run, remaining, total });
            } catch (error) {
                return json({ error: (error as Error).message }, 500);
            }
        }

        if (req.method === "POST" && url.pathname === "/seed-users") {
            try {
                const raw = await readJson(req);
                if (!raw.ok) return raw.res;
                const parsed = seedUsersSchema.safeParse(raw.body);
                if (!parsed.success) return badRequest("invalid seed-users payload", parsed.error.format());
                const { run, count, prefix } = parsed.data;
                const users = Array.from({ length: count }).map((_, i) => ({
                    id: `${prefix}_${run}_${i}`,
                    email: `${prefix}_${run}_${i}@example.com`,
                    name: `Load Test User ${i}`,
                }));
                if (!MOCK_MODE) {
                    await prisma.user.createMany({ data: users, skipDuplicates: true });
                } else {
                    Logger.info(`[MOCK] Seeding ${count} users for run ${run}`);
                }
                return json({ success: true, run, count });
            } catch (error) {
                return json({ error: (error as Error).message }, 500);
            }
        }

        if (req.method === "POST" && url.pathname === "/payments") {
            try {
                const raw = await readJson(req);
                if (!raw.ok) return raw.res;
                const parsed = paymentsBodySchema.safeParse(raw.body);
                if (!parsed.success) return badRequest("invalid payments payload", parsed.error.format());
                const body = parsed.data;
                // Paddle-shaped payload (matches what the handlers parse):
                // stable sub id per user so repeats form a valid lifecycle
                // (created -> updated* -> canceled -> created ...) instead of
                // poison-transition DLQs. Explicit body.data fields win.
                const eventType = body.event_type || "subscription.updated";
                const userId = body.userId || `user_${Math.floor(Math.random() * 10000)}`;
                const eventId = body.event_id || body.eventId || randomId();
                const ensureUser = body.ensureUser !== false;
                const now = new Date().toISOString();
                const payload = {
                    event_type: eventType,
                    event_id: eventId,
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
                    if (ensureUser) {
                        // Ensure user exists so the worker can actually update something.
                        // Pre-seeded runs pass ensureUser=false to skip this write.
                        await prisma.user.upsert({
                            where: { id: userId },
                            create: {
                                id: userId,
                                email: `${userId}@example.com`,
                                name: "Load Test User"
                            },
                            update: {}
                        });
                    }

                    const published = await publishConfirmed(PAYMENTS_QUEUE, JSON.stringify(payload));
                    if (!published) return json({ error: "broker_unavailable" }, 503);
                }
                return json({ success: true, event_id: eventId });
            } catch (error) {
                return json({ error: (error as Error).message }, 500);
            }
        }

        if (req.method === "POST" && url.pathname === "/analytics") {
            try {
                const raw = await readJson(req);
                if (!raw.ok) return raw.res;
                const parsed = analyticsBodySchema.safeParse(raw.body);
                if (!parsed.success) return badRequest("invalid analytics payload", parsed.error.format());
                const body = parsed.data;
                const userId = body.userId || `user_${Math.floor(Math.random() * 10000)}`;
                const count = body.count || 1;
                const ensureUser = body.ensureUser !== false;

                if (MOCK_MODE) {
                    Logger.info(`[MOCK] Analytics usage: ${userId} +${count}`);
                } else {
                    // Ensure user exists so the worker can successfully flush usage to DB.
                    // Pre-seeded runs pass ensureUser=false to skip this write.
                    if (ensureUser) {
                        await prisma.user.upsert({
                            where: { id: userId },
                            create: {
                                id: userId,
                                email: `${userId}@example.com`,
                                name: "Analytics Test User"
                            },
                            update: {}
                        });
                    }

                    // Contract v1: eventId (idempotency key) + event_type required.
                    const eventId = body.eventId || body.event_id || randomId();
                    const published = await publishConfirmed(
                        ANALYTICS_QUEUE,
                        JSON.stringify({ event_type: "usage_event", eventId, userId, count, timestamp: new Date().toISOString() }),
                    );
                    if (!published) return json({ error: "broker_unavailable" }, 503);
                    return json({ success: true, eventId });
                }

                return json({ success: true });
            } catch (error) {
                return json({ error: (error as Error).message }, 500);
            }
        }

        if (req.method === "POST" && url.pathname === "/cron/seed") {
            try {
                const raw = await readJson(req);
                if (!raw.ok) return raw.res;
                const parsed = cronSeedSchema.safeParse(raw.body);
                if (!parsed.success) return badRequest("invalid cron seed payload", parsed.error.format());
                const count = parsed.data.count;
                const run = parsed.data.run || `run_${Date.now().toString(36)}`;

                const now = new Date();
                const expiredDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago

                const users = Array.from({ length: count }).map((_, i) => ({
                    id: `load_test_${run}_${i}`,
                    email: `load_test_${run}_${i}@example.com`,
                    name: `Load Test User ${i}`,
                }));

                if (MOCK_MODE) {
                    Logger.info(`[MOCK] Seeding ${count} users for run ${run}`);
                } else {
                    await prisma.user.createMany({ data: users, skipDuplicates: true });

                    const subscriptions = users.map(user => ({
                        userId: user.id,
                        paddleSubscriptionId: `sub_load_${run}_${user.id}`,
                        paddlePlanId: "pro_monthly",
                        status: "ACTIVE" as any,
                        endsAt: expiredDate,
                    }));

                    await prisma.subscription.createMany({ data: subscriptions, skipDuplicates: true });
                }

                return json({ success: true, count, run });
            } catch (error) {
                return json({ error: (error as Error).message }, 500);
            }
        }

        return new Response("Not Found", { status: 404 });
    },
});

async function shutdown(signal: string): Promise<void> {
    Logger.info(`Load proxy shutting down on ${signal}`);
    try {
        await amqpChannel?.close();
    } catch {}
    try {
        await amqpConn?.close();
    } catch {}
    try {
        server.stop();
    } catch {}
    process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

Logger.info(`Load Testing Proxy running on http://localhost:${PORT}`);
