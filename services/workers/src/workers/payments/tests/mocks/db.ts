import { mock } from "bun:test";

export const mockUserUpdate = mock(() => Promise.resolve({}));
export const mockUserUpdateMany = mock(() => Promise.resolve({ count: 1 }));
export const mockUserFindUnique = mock(() => Promise.resolve({ email: "test@example.com" }));

export const prismaMock = {
    prisma: {
        user: {
            update: mockUserUpdate,
            updateMany: mockUserUpdateMany,
            findUnique: mockUserFindUnique,
        },
    },
};