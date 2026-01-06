import { mock } from "bun:test";

export const mockUserUpdate = mock(() => Promise.resolve({}));
export const mockUserUpdateMany = mock(() => Promise.resolve({ count: 1 }));

export const prismaMock = {
    prisma: {
        user: {
            update: mockUserUpdate,
            updateMany: mockUserUpdateMany,
        },
    },
};