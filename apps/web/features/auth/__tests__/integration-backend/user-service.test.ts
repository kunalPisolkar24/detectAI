import { describe, it, expect, vi, beforeEach } from 'vitest'
import { userService } from '../../services/user-service'
import { prisma } from '@/lib/infrastructure/prisma'
import { redisReader, redisWriter } from '@/lib/infrastructure/redis'

describe('UserService Integration', () => {
  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches user by ID and caches the result', async () => {
    vi.mocked(redisReader.get).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

    const user = await userService.getUserById('user-1')

    expect(user).toEqual(mockUser)
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ 
      where: { id: 'user-1' },
      include: {
        subscription: true,
        usage: true
      }
    })
    expect(redisWriter.setex).toHaveBeenCalledWith(
      expect.stringContaining('user:id:user-1'),
      expect.any(Number),
      expect.stringContaining('user-1')
    )
  })

  it('returns cached user by ID if available', async () => {
    vi.mocked(redisReader.get).mockResolvedValue(JSON.stringify(mockUser))

    const user = await userService.getUserById('user-1')

    expect(user).toEqual(mockUser)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('fetches user by email and caches both ID and email keys', async () => {
    vi.mocked(redisReader.get).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

    const user = await userService.getUserByEmail('test@example.com')

    expect(user).toEqual(mockUser)
    // One for email lookup, one for caching ID
    expect(redisWriter.setex).toHaveBeenCalledTimes(2)
  })

  it('invalidates cache on user update', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    vi.mocked(prisma.user.update).mockResolvedValue({ ...mockUser, name: 'New Name' } as any)

    await userService.updateUser('user-1', { name: 'New Name' })

    expect(prisma.user.update).toHaveBeenCalled()
    expect(redisWriter.del).toHaveBeenCalledWith(
      expect.stringContaining('user:id:user-1'),
      expect.stringContaining('user:email:test@example.com')
    )
  })
})
