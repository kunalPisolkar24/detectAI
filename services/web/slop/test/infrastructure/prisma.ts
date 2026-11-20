import { PrismaClient } from '@/lib/shared/generated/prisma/client'
import { vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, DeepMockProxy } from 'vitest-mock-extended'

export const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>

export const setupPrismaMocks = () => {
  vi.mock('@/lib/infrastructure/prisma', () => ({
    prisma: prismaMock,
  }))

  beforeEach(() => {
    mockReset(prismaMock)
  })
}
