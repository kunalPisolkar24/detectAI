import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UserService } from '../../../services/user-service'
import { userRepository } from '@/features/auth/repositories/user-repository'
import { cacheService, TTL } from '@/lib/services/cache-service'
import { lockService } from '@/lib/services/lock-service'

vi.mock('@/features/auth/repositories/user-repository')
vi.mock('@/lib/services/cache-service', () => ({
  cacheService: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    keys: {
      user: vi.fn((id: string) => `user:${id}`),
      userByEmail: vi.fn((email: string) => `user:email:${email}`),
      userBasic: vi.fn((id: string) => `user:basic:${id}`),
      userBasicByEmail: vi.fn((email: string) => `user:basic:email:${email}`),
      userSub: vi.fn((id: string) => `user:sub:${id}`),
    },
  },
  TTL: { USER: 3600, USER_BASIC: 3600, USER_SUB: 600 },
}))
vi.mock('@/lib/services/lock-service', () => ({
  lockService: {
    execute: vi.fn((_key: unknown, fn: () => unknown) => fn()),
    executeMulti: vi.fn((_keys: unknown, fn: () => unknown) => fn()),
  },
}))

// Use a fresh singleton per test file by accessing the module-level singleton
import { userService } from '../../../services/user-service'

const MOCK_USER = { id: 'user-1', email: 'test@example.com', name: 'Test User' } as any
const MOCK_UPDATED_USER = { id: 'user-1', email: 'new@example.com', name: 'Updated User' } as any

describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── getUserById (basic) ──────────────────────────────────────────────
  describe('getUserById', () => {
    it('returns user from cache when cache hit', async () => {
      vi.mocked(cacheService.get).mockResolvedValue(MOCK_USER)

      const result = await userService.getUserById('user-1')

      expect(result).toEqual(MOCK_USER)
      expect(cacheService.keys.userBasic).toHaveBeenCalledWith('user-1')
      // Repository must NOT be called on a cache hit
      expect(userRepository.findBasicById).not.toHaveBeenCalled()
    })

    it('fetches from repository on cache miss and populates cache', async () => {
      vi.mocked(cacheService.get).mockResolvedValue(null)
      vi.mocked(userRepository.findBasicById).mockResolvedValue(MOCK_USER)

      const result = await userService.getUserById('user-1')

      expect(result).toEqual(MOCK_USER)
      expect(userRepository.findBasicById).toHaveBeenCalledWith('user-1')
      expect(cacheService.set).toHaveBeenCalledWith('user:basic:user-1', MOCK_USER, TTL.USER_BASIC)
    })

    it('returns null and does NOT cache when user does not exist', async () => {
      vi.mocked(cacheService.get).mockResolvedValue(null)
      vi.mocked(userRepository.findBasicById).mockResolvedValue(null)

      const result = await userService.getUserById('ghost-user')

      expect(result).toBeNull()
      expect(cacheService.set).not.toHaveBeenCalled()
    })

    it('acquires a lock before fetching from repository to prevent cache stampede', async () => {
      vi.mocked(cacheService.get).mockResolvedValue(null)
      vi.mocked(userRepository.findBasicById).mockResolvedValue(MOCK_USER)

      await userService.getUserById('user-1')

      // lockService.execute must be called with the correct cache key
      expect(lockService.execute).toHaveBeenCalledWith('user:basic:user-1', expect.any(Function))
    })
  })

  // ─── getUserByEmail (pointer) ─────────────────────────────────────────
  describe('getUserByEmail', () => {
    it('resolves id pointer then basic cache', async () => {
      vi.mocked(cacheService.get)
        .mockResolvedValueOnce('user-1') // email pointer
        .mockResolvedValueOnce(MOCK_USER) // basic
        .mockResolvedValue(MOCK_USER)

      const result = await userService.getUserByEmail('test@example.com')

      expect(result).toEqual(MOCK_USER)
      expect(userRepository.findBasicByEmail).not.toHaveBeenCalled()
    })

    it('returns legacy full-object entries during rollout', async () => {
      vi.mocked(cacheService.get).mockResolvedValue(MOCK_USER)

      const result = await userService.getUserByEmail('test@example.com')

      expect(result).toEqual(MOCK_USER)
      expect(userRepository.findBasicByEmail).not.toHaveBeenCalled()
    })

    it('fetches from repository and warms pointer + basic caches on miss', async () => {
      vi.mocked(cacheService.get).mockResolvedValue(null)
      vi.mocked(userRepository.findBasicByEmail).mockResolvedValue(MOCK_USER)

      await userService.getUserByEmail('test@example.com')

      expect(userRepository.findBasicByEmail).toHaveBeenCalledWith('test@example.com')
      expect(cacheService.set).toHaveBeenCalledWith('user:basic:user-1', MOCK_USER, TTL.USER_BASIC)
    })

    it('returns null when user does not exist', async () => {
      vi.mocked(cacheService.get).mockResolvedValue(null)
      vi.mocked(userRepository.findBasicByEmail).mockResolvedValue(null)

      const result = await userService.getUserByEmail('nobody@example.com')

      expect(result).toBeNull()
    })
  })

  // ─── getUserSubscription ──────────────────────────────────────────────
  describe('getUserSubscription', () => {
    it('caches subscription separately from basic profile', async () => {
      const sub = { status: 'ACTIVE' } as any
      vi.mocked(cacheService.get).mockResolvedValue(null)
      vi.mocked(userRepository.findSubscriptionByUserId).mockResolvedValue(sub)

      const result = await userService.getUserSubscription('user-1')

      expect(result).toEqual(sub)
      expect(cacheService.keys.userSub).toHaveBeenCalledWith('user-1')
      expect(cacheService.set).toHaveBeenCalledWith('user:sub:user-1', sub, TTL.USER_SUB)
    })
  })

  // ─── createUser ───────────────────────────────────────────────────────
  describe('createUser', () => {
    it('delegates directly to the repository without touching the cache', async () => {
      const newUserData = { email: 'new@example.com', name: 'New User' } as any
      vi.mocked(userRepository.create).mockResolvedValue(MOCK_USER)

      const result = await userService.createUser(newUserData)

      expect(result).toEqual(MOCK_USER)
      expect(userRepository.create).toHaveBeenCalledWith(newUserData)
      // Creating a user should not pre-warm the cache (YAGNI)
      expect(cacheService.set).not.toHaveBeenCalled()
    })
  })

  // ─── updateUser (double-DEL) ──────────────────────────────────────────
  describe('updateUser', () => {
    it('throws if the user to update does not exist', async () => {
      vi.mocked(cacheService.get).mockResolvedValue(null)
      vi.mocked(userRepository.findBasicById).mockResolvedValue(null)

      await expect(userService.updateUser('ghost', { name: 'X' })).rejects.toThrow('User not found')
    })

    it('updates the user and invalidates basic + sub + email keys', async () => {
      // First lookup (getUserById) returns the current user
      vi.mocked(cacheService.get).mockResolvedValue(MOCK_USER)
      vi.mocked(userRepository.update).mockResolvedValue(MOCK_UPDATED_USER)

      await userService.updateUser('user-1', { email: 'new@example.com' })

      expect(userRepository.update).toHaveBeenCalledWith('user-1', { email: 'new@example.com' })
      expect(cacheService.del).toHaveBeenCalledWith(
        expect.arrayContaining(['user:basic:user-1', 'user:sub:user-1']),
      )
    })

    it('also evicts the NEW email pointer when email address changes', async () => {
      vi.mocked(cacheService.get).mockResolvedValue(MOCK_USER)
      // Return a user with a changed email
      vi.mocked(userRepository.update).mockResolvedValue(MOCK_UPDATED_USER)

      await userService.updateUser('user-1', { email: 'new@example.com' })

      expect(cacheService.del).toHaveBeenCalledWith(
        expect.arrayContaining(['user:basic:email:new@example.com']),
      )
    })

    it('acquires a distributed lock before performing the update', async () => {
      vi.mocked(cacheService.get).mockResolvedValue(MOCK_USER)
      vi.mocked(userRepository.update).mockResolvedValue(MOCK_UPDATED_USER)

      await userService.updateUser('user-1', { name: 'X' })

      expect(lockService.executeMulti).toHaveBeenCalledWith(
        expect.arrayContaining(['user:basic:user-1']),
        expect.any(Function),
      )
    })
  })

  // ─── invalidateUserCache ──────────────────────────────────────────────
  describe('invalidateUserCache', () => {
    it('evicts basic key when no email is provided', async () => {
      await userService.invalidateUserCache('user-1')

      expect(cacheService.del).toHaveBeenCalledWith(
        expect.arrayContaining(['user:basic:user-1']),
      )
    })

    it('evicts basic + email pointer when email is provided', async () => {
      await userService.invalidateUserCache('user-1', 'test@example.com')

      expect(cacheService.del).toHaveBeenCalledWith(
        expect.arrayContaining(['user:basic:user-1', 'user:basic:email:test@example.com']),
      )
    })
  })
})
