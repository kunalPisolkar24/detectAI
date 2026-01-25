import { mock } from "bun:test";

const mockUserUpdate = mock(() => Promise.resolve({}));
const mockUserUpdateMany = mock(() => Promise.resolve({ count: 1 }));
const mockUserFindUnique = mock(() => Promise.resolve({ email: "test@example.com" }));
const mockExecuteRawUnsafe = mock(() => Promise.resolve(0));
const mockFindMany = mock(() => Promise.resolve([]));
const mockDisconnect = mock(() => Promise.resolve());

const userMethods = {
    update: mockUserUpdate,
    updateMany: mockUserUpdateMany,
    findUnique: mockUserFindUnique,
    findMany: mockFindMany,
};

const prismaMockObj = {
    user: userMethods,
    $executeRawUnsafe: mockExecuteRawUnsafe,
    $disconnect: mockDisconnect,
};

mock.module("@shared/db", () => ({
    prisma: prismaMockObj,
    prismaPrimary: prismaMockObj,
}));
