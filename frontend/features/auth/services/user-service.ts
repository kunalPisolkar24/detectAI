import { cacheService, TTL } from "@/lib/cache-service"
import { userRepository } from "@/features/auth/repositories/user-repository"
import { User, Prisma } from "@/lib/generated/prisma/client"

export const userService = {
  async getUserById(id: string): Promise<User | null> {
    const key = cacheService.keys.user(id)

    const cachedUser = await cacheService.get<User>(key)
    if (cachedUser) {
      return cachedUser
    }

    const user = await userRepository.findById(id)

    if (user) {
      await cacheService.set(key, user, TTL.USER)
    }

    return user
  },

  async getUserByEmail(email: string): Promise<User | null> {
    const key = cacheService.keys.userByEmail(email)

    const cachedUser = await cacheService.get<User>(key)
    if (cachedUser) {
      return cachedUser
    }

    const user = await userRepository.findByEmail(email)

    if (user) {
      await Promise.all([
        cacheService.set(key, user, TTL.USER),
        cacheService.set(cacheService.keys.user(user.id), user, TTL.USER)
      ])
    }

    return user
  },

  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    return userRepository.create(data)
  },

  async updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    const user = await userRepository.update(id, data)

    await cacheService.del([
      cacheService.keys.user(id),
      cacheService.keys.userByEmail(user.email)
    ])

    return user
  },

  async invalidateUserCache(userId: string, email?: string) {
    const keys = [cacheService.keys.user(userId)]
    if (email) keys.push(cacheService.keys.userByEmail(email))

    await cacheService.del(keys)
  }
}