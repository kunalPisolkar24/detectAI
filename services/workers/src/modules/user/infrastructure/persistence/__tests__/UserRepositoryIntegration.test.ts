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
});
