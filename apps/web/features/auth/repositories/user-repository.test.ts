import { describe, it, expect, vi, beforeEach } from 'vitest'
import { userRepository } from './user-repository'
import { prisma } from '@/lib/infrastructure/prisma'

vi.mock('@/lib/infrastructure/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

describe('userRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('findById', () => {
    it('finds a user by id', async () => {
      const mockUser = { id: '1', email: 'test@example.com' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

      const result = await userRepository.findById('1')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      })
      expect(result).toEqual(mockUser)
    })

    it('returns null if user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      const result = await userRepository.findById('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('findByEmail', () => {
    it('finds a user by email', async () => {
      const mockUser = { id: '1', email: 'test@example.com' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

      const result = await userRepository.findByEmail('test@example.com')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      })
      expect(result).toEqual(mockUser)
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
