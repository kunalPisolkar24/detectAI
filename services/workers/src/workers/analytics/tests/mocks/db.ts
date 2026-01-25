import { mock } from "bun:test";

export const mockExecuteRawUnsafe = mock(() => Promise.resolve(0));
export const mockDisconnect = mock(() => Promise.resolve());

export const prismaMock = {
  prisma: {
    $executeRawUnsafe: mockExecuteRawUnsafe,
    $disconnect: mockDisconnect,
  },
  prismaPrimary: {
    $executeRawUnsafe: mockExecuteRawUnsafe,
    $disconnect: mockDisconnect,
  },
};