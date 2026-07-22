import { expect, test, describe, beforeEach } from "bun:test";
import "../../../../../tests/setup-integration";
import { prismaPrimary, prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { SubscriptionSweeper } from "../SubscriptionSweeper";
import { SubscriptionStatus } from "../../../../../../generated/prisma/client";
import { Pool } from "pg";

describe("SubscriptionSweeper Integration", () => {
    let sweeper: SubscriptionSweeper;
    let redis: any;
    let userRepository: PrismaUserRepository;

    beforeEach(async () => {
        redis = RedisFactory.createClient({
            mode: "standalone",
            name: "test-redis",
            url: process.env.REDIS_URL,
        });
        const metrics = new MetricsService("test-cron");
        userRepository = new PrismaUserRepository(prismaPrimary, prisma);
        sweeper = new SubscriptionSweeper(userRepository, redis, metrics);
    });

    test("should sweep expired subscriptions", async () => {
        // 1. Create users with different subscription states
        const now = new Date();
        const expiredDate = new Date(now.getTime() - 10000);
        const futureDate = new Date(now.getTime() + 86400000);

        const userExpired = await prismaPrimary.user.create({
            data: {
                email: "expired@example.com",
                name: "Expired User",
                subscription: {
                    create: {
                        status: SubscriptionStatus.ACTIVE,
                        endsAt: expiredDate,
                        paddleSubscriptionId: "sub_expired",
                        paddlePlanId: "plan_1",
                    }
                }
            }
        });

        const userActive = await prismaPrimary.user.create({
            data: {
                email: "active@example.com",
                name: "Active User",
                subscription: {
                    create: {
                        status: SubscriptionStatus.ACTIVE,
                        endsAt: futureDate,
                        paddleSubscriptionId: "sub_active",
                        paddlePlanId: "plan_1",
                    }
                }
            }
        });

        // 2. Process expired subscriptions
        const swept = await sweeper.processExpiredSubscriptions();
        expect(swept).toBe(1);

        // 3. Verify userExpired is CANCELED
        const updatedExpired = await prismaPrimary.subscription.findUnique({
            where: { userId: userExpired.id }
        });
        expect(updatedExpired?.status).toBe(SubscriptionStatus.CANCELED);

        // 4. Verify userActive is still ACTIVE
        const updatedActive = await prismaPrimary.subscription.findUnique({
            where: { userId: userActive.id }
        });
        expect(updatedActive?.status).toBe(SubscriptionStatus.ACTIVE);
    });

    test("should skip locked subscriptions with SKIP LOCKED", async () => {
        const expiredDate = new Date(Date.now() - 10000);

        const [user1, user2] = await Promise.all([
            prismaPrimary.user.create({
                data: {
                    email: "skip-lock-1@test.com",
                    subscription: {
                        create: { status: SubscriptionStatus.ACTIVE, endsAt: expiredDate },
                    },
                },
            }),
            prismaPrimary.user.create({
                data: {
                    email: "skip-lock-2@test.com",
                    subscription: {
                        create: { status: SubscriptionStatus.ACTIVE, endsAt: expiredDate },
                    },
                },
            }),
        ]);

        const lockPool = new Pool({ connectionString: process.env.DATABASE_URL });
        const lockClient = await lockPool.connect();
        try {
            await lockClient.query("BEGIN");
            await lockClient.query(
                `SELECT id FROM "Subscription" WHERE "userId" = $1 FOR UPDATE`,
                [user1.id],
            );

            const swept = await sweeper.processExpiredSubscriptions();
            expect(swept).toBe(1);

            const sub2 = await prismaPrimary.subscription.findUnique({ where: { userId: user2.id } });
            expect(sub2?.status).toBe(SubscriptionStatus.CANCELED);
        } finally {
            await lockClient.query("ROLLBACK");
            lockClient.release();
            await lockPool.end();
        }
    });
});
