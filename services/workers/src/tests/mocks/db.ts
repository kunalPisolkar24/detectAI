import { mock } from "bun:test";

export function makePrismaMock(overrides: Record<string, unknown> = {}) {
    const mockExecuteRaw = mock(() => Promise.resolve(0));
    const mockDisconnect = mock(() => Promise.resolve());
    const mockFindMany = mock(() => Promise.resolve([]));
    const mockUpdateMany = mock(() => Promise.resolve({ count: 0 }));
    const mockUserUpdate = mock(() => Promise.resolve({}));
    const mockUserFindUnique = mock(() => Promise.resolve({ email: "test@example.com" } as { email: string } | null));
    return {
        mockExecuteRaw,
        mockDisconnect,
        mockFindMany,
        mockUpdateMany,
        mockUserUpdate,
        mockUserFindUnique,
        prisma: {
            user: {
                findMany: mockFindMany,
                updateMany: mockUpdateMany,
                update: mockUserUpdate,
                findUnique: mockUserFindUnique,
            },
            subscription: {
                groupBy: mock(() => Promise.resolve([])),
            },
            $executeRaw: mockExecuteRaw,
            $queryRaw: mock(() => Promise.resolve([])),
            $queryRawUnsafe: mock(() => Promise.resolve([])),
            $executeRawUnsafe: mock(() => Promise.resolve(0)),
            $transaction: mock((fn: any) => fn({})),
            $disconnect: mockDisconnect,
        },
        prismaPrimary: {
            user: {
                findMany: mockFindMany,
                updateMany: mockUpdateMany,
                update: mockUserUpdate,
                findUnique: mockUserFindUnique,
            },
            subscription: {
                groupBy: mock(() => Promise.resolve([])),
            },
            $executeRaw: mockExecuteRaw,
            $queryRaw: mock(() => Promise.resolve([])),
            $queryRawUnsafe: mock(() => Promise.resolve([])),
            $executeRawUnsafe: mock(() => Promise.resolve(0)),
            $transaction: mock((fn: any) => fn({})),
            $disconnect: mockDisconnect,
        },
        ...overrides,
    };
}

export const prismaMock = makePrismaMock();

export const mockExecuteRaw = prismaMock.mockExecuteRaw;
export const mockFindMany = prismaMock.mockFindMany;
export const mockUpdateMany = prismaMock.mockUpdateMany;
export const mockUserUpdate = prismaMock.mockUserUpdate;
