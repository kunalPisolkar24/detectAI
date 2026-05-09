import { mock } from "bun:test";

export const mockExecuteRaw = mock(() => Promise.resolve(0));
export const mockDisconnect = mock(() => Promise.resolve());

export const prismaMock = {
  prisma: {
    $executeRaw: mockExecuteRaw,
    $disconnect: mockDisconnect,
  },
  prismaPrimary: {
    $executeRaw: mockExecuteRaw,
    $disconnect: mockDisconnect,
  },
};