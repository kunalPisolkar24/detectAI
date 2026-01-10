import { cacheService, TTL } from "@/lib/cache-service"
import { userRepository } from "@/features/auth/repositories/user-repository"
import { User, Prisma } from "@/lib/generated/prisma/client"
import { lockService } from "@/lib/lock-service"

export const userService = {
  async getUserById(id: string): Promise<User | null> {
    const key = cacheService.keys.user(id)

    const cachedUser = await cacheService.get<User>(key)
    if (cachedUser) {
      return cachedUser
    }

    const release = await lockService.acquire(key)
    
    if (!release) {
      return userRepository.findById(id)
    }

    try {
      const doubleCheck = await cacheService.get<User>(key)
      if (doubleCheck) {
        return doubleCheck
      }

      const user = await userRepository.findById(id)

      if (user) {
        await cacheService.set(key, user, TTL.USER)
      }

      return user
    } finally {
      await release()
    }
  },

  async getUserByEmail(email: string): Promise<User | null> {
    const key = cacheService.keys.userByEmail(email)

    const cachedUser = await cacheService.get<User>(key)
    if (cachedUser) {
      return cachedUser
    }

    const release = await lockService.acquire(key)
    if (!release) return userRepository.findByEmail(email)

    try {
      const doubleCheck = await cacheService.get<User>(key)
      if (doubleCheck) return doubleCheck

      const user = await userRepository.findByEmail(email)

      if (user) {
        await Promise.all([
          cacheService.set(key, user, TTL.USER),
          cacheService.set(cacheService.keys.user(user.id), user, TTL.USER)
        ])
      }

      return user
    } finally {
      await release()
    }
  },

  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    return userRepository.create(data)
  },

  async updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    const user = await userRepository.update(id, data)

    const idKey = cacheService.keys.user(id)
    const emailKey = cacheService.keys.userByEmail(user.email)
    
    const releaseId = await lockService.acquire(idKey)
    const releaseEmail = await lockService.acquire(emailKey)

    try {
      await cacheService.del([idKey, emailKey])
    } finally {
      if (releaseId) await releaseId()
      if (releaseEmail) await releaseEmail()
    }

    return user
  },

  async invalidateUserCache(userId: string, email?: string) {
    const keys = [cacheService.keys.user(userId)]
    if (email) keys.push(cacheService.keys.userByEmail(email))

    await cacheService.del(keys)
  }
}