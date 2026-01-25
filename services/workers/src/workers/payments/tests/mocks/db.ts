import { mock } from "bun:test";

export const mockUserUpdate = mock(() => Promise.resolve({}));
export const mockUserUpdateMany = mock(() => Promise.resolve({ count: 1 }));
export const mockUserFindUnique = mock(() => Promise.resolve({ email: "test@example.com" } as { email: string } | null));


const userMethods = {
    update: mockUserUpdate,
    updateMany: mockUserUpdateMany,
    findUnique: mockUserFindUnique,
};

export const prisma = {
    user: userMethods,
};

export const prismaPrimary = {
    user: userMethods,
};

export const prismaMock = {
    prisma,
    prismaPrimary,
};