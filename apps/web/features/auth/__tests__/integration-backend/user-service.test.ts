import { describe, it, expect, vi, beforeEach } from 'vitest'
import { userService } from '../../services/user-service'
import { prisma } from '@/lib/infrastructure/prisma'
import { redis } from '@/lib/infrastructure/redis'

describe('UserService Integration', () => {
  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches basic user by ID and caches the result (no joins)', async () => {
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

    const user = await userService.getUserById('user-1')

    expect(user).toEqual(mockUser)
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    })
    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining('user:basic:user-1'),
      expect.any(Number),
      expect.stringContaining('user-1')
    )
  })

  it('returns cached user by ID if available', async () => {
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(mockUser))

    const user = await userService.getUserById('user-1')

    expect(user).toEqual(mockUser)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('fetches user by email via id pointer and warms both caches', async () => {
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

    const user = await userService.getUserByEmail('test@example.com')

    expect(user).toEqual(mockUser)
    // One for email pointer, one for basic
    expect(redis.setex).toHaveBeenCalledTimes(2)
  })

  it('fetches subscription separately with short TTL', async () => {
    const sub = { status: 'ACTIVE' }
    vi.mocked(redis.get).mockResolvedValue(null)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(sub as any)

    const result = await userService.getUserSubscription('user-1')

    expect(result).toEqual(sub)
    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining('user:sub:user-1'),
      600,
      expect.any(String),
    )
  })

  it('invalidates basic + sub caches on user update (double-DEL)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)
    vi.mocked(prisma.user.update).mockResolvedValue({ ...mockUser, name: 'New Name' } as any)

    await userService.updateUser('user-1', { name: 'New Name' })

    expect(prisma.user.update).toHaveBeenCalled()
    const deleted = vi.mocked(redis.del).mock.calls.flat() as unknown as string[]
    expect(deleted).toEqual(
      expect.arrayContaining(['user:basic:user-1', 'user:sub:user-1']),
    )
  })
})
