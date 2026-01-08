import { mock } from "bun:test";
export const mockUserUpdate = mock(() => Promise.resolve({}));
export const mockPrismaTransaction = mock((promises: any[]) => Promise.resolve(promises));
export const prismaMock = {
  prisma: {
    user: {
      update: mockUserUpdate,
    },
    $transaction: mockPrismaTransaction,
    $disconnect: mock(() => Promise.resolve()),
  },
};