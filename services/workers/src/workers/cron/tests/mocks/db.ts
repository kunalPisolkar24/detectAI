import { mock } from "bun:test";

export const mockFindMany = mock(() => Promise.resolve([]));
export const mockUpdateMany = mock(() => Promise.resolve({ count: 0 }));

export const prismaMock = {
    prisma: {
        user: {
            findMany: mockFindMany,
            updateMany: mockUpdateMany,
        },
        $disconnect: mock(() => Promise.resolve()),
    },
    prismaPrimary: {
        user: {
            findMany: mockFindMany,
            updateMany: mockUpdateMany,
        },
        $disconnect: mock(() => Promise.resolve()),
    },
};