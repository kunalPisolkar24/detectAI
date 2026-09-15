import { describe, it, expect, vi, beforeEach } from 'vitest'
import { userRepository } from '../../../repositories/user-repository'
import { prisma } from '@/lib/infrastructure/prisma'

vi.mock('@/lib/infrastructure/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(),
    },
  },
}))

describe('userRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('findBasicById', () => {
    it('finds profile row without joins', async () => {
      const mockUser = { id: '1', email: 'test@example.com' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

      const result = await userRepository.findBasicById('1')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: '1' } })
      expect(result).toEqual(mockUser)
    })
  })

  describe('findSubscriptionByUserId', () => {
    it('finds subscription row for split cache', async () => {
      const mockSub = { status: 'ACTIVE' }
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(mockSub as any)

      const result = await userRepository.findSubscriptionByUserId('1')

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({ where: { userId: '1' } })
      expect(result).toEqual(mockSub)
    })
  })

  describe('create', () => {
    it('creates a new user', async () => {
      const userData = { email: 'new@example.com', name: 'New User' }
      const mockUser = { id: '2', ...userData }
      vi.mocked(prisma.user.create).mockResolvedValue(mockUser as any)

      const result = await userRepository.create(userData as any)

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: userData,
      })
      expect(result).toEqual(mockUser)
    })
  })

  describe('update', () => {
    it('updates an existing user', async () => {
      const updateData = { name: 'Updated Name' }
      const mockUser = { id: '1', email: 'test@example.com', ...updateData }
      vi.mocked(prisma.user.update).mockResolvedValue(mockUser as any)

      const result = await userRepository.update('1', updateData)

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: updateData,
      })
      expect(result).toEqual(mockUser)
    })
  })
})
