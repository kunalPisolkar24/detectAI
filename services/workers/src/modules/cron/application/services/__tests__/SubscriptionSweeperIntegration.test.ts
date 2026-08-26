import { expect, test, describe, beforeEach } from "bun:test";
import "../../../../../tests/setup-integration";
import { prismaPrimary, prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { validateTransition } from "@modules/payments/domain/stateMachine";
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

    test("should sweep expired PAST_DUE subscriptions to CANCELED", async () => {
        const expiredDate = new Date(Date.now() - 10000);
        const futureDate = new Date(Date.now() + 86400000);

        const userPastDue = await prismaPrimary.user.create({
            data: {
                email: "past-due-expired@example.com",
                subscription: {
                    create: { status: SubscriptionStatus.PAST_DUE, endsAt: expiredDate },
                },
            },
        });
        const userPastDueActiveWindow = await prismaPrimary.user.create({
            data: {
                email: "past-due-future@example.com",
                subscription: {
                    create: { status: SubscriptionStatus.PAST_DUE, endsAt: futureDate },
                },
            },
        });

        const swept = await sweeper.processExpiredSubscriptions();

        expect(swept).toBeGreaterThanOrEqual(1);

        const sweptSub = await prismaPrimary.subscription.findUnique({ where: { userId: userPastDue.id } });
        expect(sweptSub?.status).toBe(SubscriptionStatus.CANCELED);

        const untouched = await prismaPrimary.subscription.findUnique({ where: { userId: userPastDueActiveWindow.id } });
        expect(untouched?.status).toBe(SubscriptionStatus.PAST_DUE);
    });

    test("should stamp eventTimestamp on swept subscriptions", async () => {
        const expiredDate = new Date(Date.now() - 60000);

        const user = await prismaPrimary.user.create({
            data: {
                email: "stamp-event-ts@example.com",
                subscription: {
                    create: { status: SubscriptionStatus.ACTIVE, endsAt: expiredDate },
                },
            },
        });

        const before = Date.now();
        await sweeper.processExpiredSubscriptions();
        const after = Date.now();

        const sub = await prismaPrimary.subscription.findUnique({ where: { userId: user.id } });
        expect(sub?.status).toBe(SubscriptionStatus.CANCELED);
        expect(sub?.eventTimestamp).not.toBeNull();

        const stamped = sub!.eventTimestamp!.getTime();
        expect(stamped).toBeGreaterThanOrEqual(before);
        expect(stamped).toBeLessThanOrEqual(after);
    });

    test("should reject stale webhook replay after sweep but accept fresh resubscribe", async () => {
        const expiredDate = new Date(Date.now() - 60000);

        const user = await prismaPrimary.user.create({
            data: {
                email: "replay@example.com",
                subscription: {
                    create: {
                        status: SubscriptionStatus.ACTIVE,
                        endsAt: expiredDate,
                        eventTimestamp: new Date(Date.now() - 120000),
                    },
                },
            },
        });

        const validatingRepo = new PrismaUserRepository(prismaPrimary, prisma, validateTransition);
        const sweepTime = new Date(Date.now() - 30000);
        const swept = await validatingRepo.expireDueSubscriptions(10, {
            status: SubscriptionStatus.CANCELED,
            cancellationScheduled: false,
            paddleSubscriptionId: null,
            paddlePlanId: null,
            eventTimestamp: sweepTime,
        }, sweepTime);
        expect(swept).toHaveLength(1);

        const staleReplay = await validatingRepo.lockAndUpdateSubscription(
            user.id,
            new Date(sweepTime.getTime() - 3600_000),
            SubscriptionStatus.ACTIVE,
            { paddleCustomerId: "cus_x", paddleSubscriptionId: "sub_replay", paddlePlanId: "plan_1", status: SubscriptionStatus.ACTIVE, endsAt: null },
        );
        expect(staleReplay.stale).toBe(true);

        const afterReplay = await prismaPrimary.subscription.findUnique({ where: { userId: user.id } });
        expect(afterReplay?.status).toBe(SubscriptionStatus.CANCELED);

        const freshResubscribe = await validatingRepo.lockAndUpdateSubscription(
            user.id,
            new Date(sweepTime.getTime() + 3600_000),
            SubscriptionStatus.ACTIVE,
            { paddleCustomerId: "cus_x", paddleSubscriptionId: "sub_fresh", paddlePlanId: "plan_1", status: SubscriptionStatus.ACTIVE, endsAt: null },
        );
        expect(freshResubscribe.stale).toBe(false);

        const afterResubscribe = await prismaPrimary.subscription.findUnique({ where: { userId: user.id } });
        expect(afterResubscribe?.status).toBe(SubscriptionStatus.ACTIVE);
        expect(afterResubscribe?.eventTimestamp!.getTime()).toBe(new Date(sweepTime.getTime() + 3600_000).getTime());
    });

    test("should return only actually mutated users", async () => {
        const expiredDate = new Date(Date.now() - 60000);
        const futureDate = new Date(Date.now() + 86400000);

        const [expired1, expired2, stillActive] = await Promise.all([
            prismaPrimary.user.create({
                data: {
                    email: "mutated-1@example.com",
                    subscription: { create: { status: SubscriptionStatus.TRIALING, endsAt: expiredDate } },
                },
            }),
            prismaPrimary.user.create({
                data: {
                    email: "mutated-2@example.com",
                    subscription: { create: { status: SubscriptionStatus.PAST_DUE, endsAt: expiredDate } },
                },
            }),
            prismaPrimary.user.create({
                data: {
                    email: "mutated-future@example.com",
                    subscription: { create: { status: SubscriptionStatus.ACTIVE, endsAt: futureDate } },
                },
            }),
        ]);

        const sweepTime = new Date();
        const mutated = await userRepository.expireDueSubscriptions(10, {
            status: SubscriptionStatus.CANCELED,
            cancellationScheduled: false,
            paddleSubscriptionId: null,
            paddlePlanId: null,
            eventTimestamp: sweepTime,
        }, sweepTime);

        expect(mutated.map(user => user.id).sort()).toEqual([expired1.id, expired2.id].sort());

        for (const mutatedUser of mutated) {
            const sub = await prismaPrimary.subscription.findUnique({ where: { userId: mutatedUser.id } });
            expect(sub?.status).toBe(SubscriptionStatus.CANCELED);
        }

        const activeSub = await prismaPrimary.subscription.findUnique({ where: { userId: stillActive.id } });
        expect(activeSub?.status).toBe(SubscriptionStatus.ACTIVE);
    });

    test("should sweep expired PAUSED subscriptions and leave future ones", async () => {
        const expiredDate = new Date(Date.now() - 60000);
        const futureDate = new Date(Date.now() + 86400000);

        const [pausedExpired, pausedFuture] = await Promise.all([
            prismaPrimary.user.create({
                data: {
                    email: "paused-expired@example.com",
                    subscription: { create: { status: SubscriptionStatus.PAUSED, endsAt: expiredDate } },
                },
            }),
            prismaPrimary.user.create({
                data: {
                    email: "paused-future@example.com",
                    subscription: { create: { status: SubscriptionStatus.PAUSED, endsAt: futureDate } },
                },
            }),
        ]);

        await sweeper.processExpiredSubscriptions();

        const sweptSub = await prismaPrimary.subscription.findUnique({ where: { userId: pausedExpired.id } });
        expect(sweptSub?.status).toBe(SubscriptionStatus.CANCELED);

        const untouchedSub = await prismaPrimary.subscription.findUnique({ where: { userId: pausedFuture.id } });
        expect(untouchedSub?.status).toBe(SubscriptionStatus.PAUSED);
    });

    test("should never sweep NULL status or NULL endsAt rows", async () => {
        const expiredDate = new Date(Date.now() - 60000);

        const [nullStatus, nullEndsAt] = await Promise.all([
            prismaPrimary.user.create({
                data: {
                    email: "null-status@example.com",
                    subscription: { create: { status: null, endsAt: expiredDate } },
                },
            }),
            prismaPrimary.user.create({
                data: {
                    email: "null-ends-at@example.com",
                    subscription: { create: { status: SubscriptionStatus.ACTIVE, endsAt: null } },
                },
            }),
        ]);

        await sweeper.processExpiredSubscriptions();

        for (const user of [nullStatus, nullEndsAt]) {
            const sub = await prismaPrimary.subscription.findUnique({ where: { userId: user.id } });
            expect(sub?.status).not.toBe(SubscriptionStatus.CANCELED);
            expect(sub?.eventTimestamp).toBeNull();
        }
    });

    test("should clear cancellationScheduled and paddle identifiers as terminal state", async () => {
        const expiredDate = new Date(Date.now() - 60000);

        const user = await prismaPrimary.user.create({
            data: {
                email: "terminal-wipe@example.com",
                subscription: {
                    create: {
                        status: SubscriptionStatus.ACTIVE,
                        endsAt: expiredDate,
                        paddleSubscriptionId: "sub_terminal",
                        paddlePlanId: "plan_9",
                        cancellationScheduled: true,
                    },
                },
            },
        });

        await sweeper.processExpiredSubscriptions();

        const sub = await prismaPrimary.subscription.findUnique({ where: { userId: user.id } });
        expect(sub?.status).toBe(SubscriptionStatus.CANCELED);
        expect(sub?.cancellationScheduled).toBe(false);
        expect(sub?.paddleSubscriptionId).toBeNull();
        expect(sub?.paddlePlanId).toBeNull();
    });
});
