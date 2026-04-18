import { describe, it, expect, vi, beforeEach } from 'vitest'
import { userService } from './user-service'
import { userRepository } from '@/features/auth/repositories/user-repository'
import { cacheService } from '@/lib/cache-service'
import { lockService } from '@/lib/lock-service'

vi.mock('@/features/auth/repositories/user-repository')
vi.mock('@/lib/cache-service', () => ({
  cacheService: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    keys: {
      user: vi.fn((id) => `user:${id}`),
      userByEmail: vi.fn((email) => `user:email:${email}`),
    }
  },
  TTL: { USER: 3600 }
}))
vi.mock('@/lib/lock-service', () => ({
  lockService: {
    execute: vi.fn((key, fn) => fn()),
  }
}))

describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getUserById', () => {
    it('should return user from cache if available', async () => {
      const mockUser = { id: '1', email: 'test@example.com' }
      vi.mocked(cacheService.get).mockResolvedValue(mockUser)

      const user = await userService.getUserById('1')

      expect(user).toEqual(mockUser)
      expect(cacheService.get).toHaveBeenCalledWith('user:1')
      expect(userRepository.findById).not.toHaveBeenCalled()
    })

    it('should fetch from repository and cache if not in cache', async () => {
      const mockUser = { id: '1', email: 'test@example.com' }
      vi.mocked(cacheService.get).mockResolvedValue(null)
      vi.mocked(userRepository.findById).mockResolvedValue(mockUser as any)

      const user = await userService.getUserById('1')

      expect(user).toEqual(mockUser)
      expect(userRepository.findById).toHaveBeenCalledWith('1')
      expect(cacheService.set).toHaveBeenCalledWith('user:1', mockUser, expect.any(Number))
    })

    it('should return null if user not found in cache or repository', async () => {
      vi.mocked(cacheService.get).mockResolvedValue(null)
      vi.mocked(userRepository.findById).mockResolvedValue(null)

      const user = await userService.getUserById('1')

      expect(user).toBeNull()
      expect(cacheService.set).not.toHaveBeenCalled()
    })
  })

  describe('createUser', () => {
    it('should call repository.create', async () => {
      const mockUser = { id: '1', email: 'new@example.com' }
      const userData = { email: 'new@example.com', password: 'hash' }
      vi.mocked(userRepository.create).mockResolvedValue(mockUser as any)

      const user = await userService.createUser(userData as any)

      expect(user).toEqual(mockUser)
      expect(userRepository.create).toHaveBeenCalledWith(userData)
    })
  })
})
