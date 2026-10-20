import { expect, test, describe } from "bun:test";
import "../../../../../tests/setup-integration";
import { prismaPrimary, prisma } from "@shared/database/PrismaService";
import { PrismaUserRepository } from "../PrismaUserRepository";

describe("UserRepository Integration", () => {
    const repository = new PrismaUserRepository(prismaPrimary, prisma);

    test("should increment usage and handle conflict", async () => {
        const user = await prismaPrimary.user.create({
            data: {
                email: "test-usage@example.com",
                name: "Test User",
            },
        });

        await repository.incrementUsage(user.id, 5);
        
        let usage = await prismaPrimary.usage.findUnique({
            where: { userId: user.id },
        });
        expect(usage?.apiCallCountTotal).toBe(5);
        expect(usage?.apiCallCountDaily).toBe(5);

        await repository.incrementUsage(user.id, 10);
        
        usage = await prismaPrimary.usage.findUnique({
            where: { userId: user.id },
        });
        expect(usage?.apiCallCountTotal).toBe(15);
        expect(usage?.apiCallCountDaily).toBe(15);
    });

    test("should find unique user by id", async () => {
        const user = await prismaPrimary.user.create({
            data: {
                email: "test-find@example.com",
                name: "Find User",
            },
        });

        const found = await repository.findUniqueById(user.id);
        expect(found?.email).toBe("test-find@example.com");
    });

    describe("expireDueSubscriptions", () => {
        const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

        const seedExpired = async (email: string, endsAt: Date, eventTimestamp?: Date) => {
            const user = await prismaPrimary.user.create({ data: { email } });
            await prismaPrimary.subscription.create({
                data: {
                    userId: user.id,
                    status: "ACTIVE",
                    endsAt,
                    eventTimestamp: eventTimestamp ?? null,
                },
            });
            return user;
        };

        test("cancels the expired subscriptions it selects and returns them", async () => {
            const user = await seedExpired("expired-1@example.com", daysAgo(1));

            const swept = await repository.expireDueSubscriptions(
                100,
                { status: "CANCELED", cancellationScheduled: false, paddleSubscriptionId: null, paddlePlanId: null },
                new Date(),
            );

            expect(swept.map((s) => s.id)).toEqual([user.id]);

            const sub = await prismaPrimary.subscription.findUnique({ where: { userId: user.id } });
            expect(sub?.status).toBe("CANCELED");
        });

        test("does not return a row that lost the race to a fresher webhook", async () => {
            // Selected by the sweep, but its eventTimestamp is newer than the
            // sweep clock, so the UPDATE must leave it alone. The row used to
            // be returned anyway by a slice fallback, which meant the sweeper
            // invalidated caches for a subscription it had not touched.
            const user = await seedExpired("expired-2@example.com", daysAgo(1), new Date(Date.now() + 60_000));

            const swept = await repository.expireDueSubscriptions(
                100,
                { status: "CANCELED", cancellationScheduled: false, paddleSubscriptionId: null, paddlePlanId: null },
                new Date(),
            );

            expect(swept.map((s) => s.id)).not.toContain(user.id);

            const sub = await prismaPrimary.subscription.findUnique({ where: { userId: user.id } });
            expect(sub?.status).toBe("ACTIVE");
        });

        test("returns only the rows it updated when some are skipped", async () => {
            const stale = await seedExpired("expired-3a@example.com", daysAgo(2), new Date(Date.now() + 60_000));
            const fresh = await seedExpired("expired-3b@example.com", daysAgo(1));

            const swept = await repository.expireDueSubscriptions(
                100,
                { status: "CANCELED", cancellationScheduled: false, paddleSubscriptionId: null, paddlePlanId: null },
                new Date(),
            );

            const ids = swept.map((s) => s.id);
            expect(ids).toContain(fresh.id);
            expect(ids).not.toContain(stale.id);
        });

        test("countExpiredSubscriptions counts what is still pending", async () => {
            await seedExpired("count-1@example.com", daysAgo(1));
            await seedExpired("count-2@example.com", daysAgo(1));
            // Not expired yet.
            const active = await prismaPrimary.user.create({ data: { email: "count-active@example.com" } });
            await prismaPrimary.subscription.create({
                data: { userId: active.id, status: "ACTIVE", endsAt: new Date(Date.now() + 86_400_000) },
            });

            const before = await repository.countExpiredSubscriptions(new Date());
            expect(before).toBe(2);

            await repository.expireDueSubscriptions(
                100,
                { status: "CANCELED", cancellationScheduled: false, paddleSubscriptionId: null, paddlePlanId: null },
                new Date(),
            );

            const after = await repository.countExpiredSubscriptions(new Date());
            expect(after).toBe(0);
        });
    });
});
