import { cacheService, TTL } from "@/lib/cache-service"
import { userRepository } from "@/features/auth/repositories/user-repository"
import { User, Prisma } from "@/lib/shared/generated/prisma/client"
import { lockService } from "@/lib/lock-service"

export class UserService {
  private static instance: UserService

  private constructor() {}

  public static getInstance(): UserService {
    if (!UserService.instance) {
      UserService.instance = new UserService()
    }
    return UserService.instance
  }

  public async getUserById(id: string): Promise<User | null> {
    return this.fetchThroughCache(
      cacheService.keys.user(id),
      () => userRepository.findById(id)
    )
  }

  public async getUserByEmail(email: string): Promise<User | null> {
    const emailKey = cacheService.keys.userByEmail(email)
    
    return this.fetchThroughCache(
      emailKey,
      async () => {
        const user = await userRepository.findByEmail(email)
        if (user) {
          await cacheService.set(cacheService.keys.user(user.id), user, TTL.USER)
        }
        return user
      }
    )
  }

  public async createUser(data: Prisma.UserCreateInput): Promise<User> {
    return userRepository.create(data)
  }

  public async updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    const currentUser = await this.getUserById(id)
    if (!currentUser) {
      throw new Error("User not found")
    }

    const idKey = cacheService.keys.user(id)
    const emailKey = cacheService.keys.userByEmail(currentUser.email)
    const lockKeys = [idKey, emailKey]

    return lockService.execute(lockKeys, async () => {
      const updatedUser = await userRepository.update(id, data)

      const keysInvalidate = [idKey, emailKey]
      
      if (updatedUser.email !== currentUser.email) {
        keysInvalidate.push(cacheService.keys.userByEmail(updatedUser.email))
      }

      await cacheService.del(keysInvalidate)

      return updatedUser
    })
  }

  public async invalidateUserCache(userId: string, email?: string): Promise<void> {
    const keys = [cacheService.keys.user(userId)]
    if (email) {
      keys.push(cacheService.keys.userByEmail(email))
    }
    
    await cacheService.del(keys)
  }

  private async fetchThroughCache<T>(
    key: string,
    fetcher: () => Promise<T | null>
  ): Promise<T | null> {
    const cached = await cacheService.get<T>(key)
    if (cached) {
      return cached
    }

    return lockService.execute(key, async () => {
      const doubleCheck = await cacheService.get<T>(key)
      if (doubleCheck) {
        return doubleCheck
      }

      const data = await fetcher()

      if (data) {
        await cacheService.set(key, data, TTL.USER)
      }

      return data
    })
  }
}

export const userService = UserService.getInstance()