import { PrismaClient } from '@/lib/generated/prisma/client'
import { beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, DeepMockProxy } from 'vitest-mock-extended'

vi.mock('@/lib/prisma', () => ({
  prisma: mockDeep<PrismaClient>(),
}))

import { prisma } from '@/lib/prisma'

export const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(prismaMock)
})
