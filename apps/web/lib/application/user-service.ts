import { cacheService, TTL } from "@/lib/services/cache-service"
import { userRepository } from "@/features/auth/repositories/user-repository"
import { User, Prisma, Subscription } from "@/lib/shared/generated/prisma/client"
import { lockService } from "@/lib/services/lock-service"

const DELAYED_DEL_MS = 200

function delayedDel(keys: string[]): void {
  if (keys.length === 0) return
  setTimeout(() => {
    cacheService.del(keys).catch(() => {})
  }, DELAYED_DEL_MS).unref?.()
}

export class UserService {
  private static instance: UserService

  private constructor() {}

  public static getInstance(): UserService {
    if (!UserService.instance) {
      UserService.instance = new UserService()
    }
    return UserService.instance
  }

  public async getUserById(id: string) {
    return this.fetchThroughCache(
      cacheService.keys.userBasic(id),
      () => userRepository.findBasicById(id),
      TTL.USER_BASIC,
    )
  }

  public async getUserByEmail(email: string) {
    const emailKey = cacheService.keys.userBasicByEmail(email)

    const pointer = await cacheService.get<string>(emailKey)
    if (pointer) {
      const basic = await this.getUserById(pointer)
      if (basic) return basic
    }

    return lockService.execute(emailKey, async () => {
      const doubleCheck = await cacheService.get<string>(emailKey)
      if (doubleCheck) {
        const basic = await this.getUserById(doubleCheck)
        if (basic) return basic
      }

      const user = await userRepository.findBasicByEmail(email)
      if (user) {
        await cacheService.set(emailKey, user.id, TTL.USER_BASIC)
        await cacheService.set(cacheService.keys.userBasic(user.id), user, TTL.USER_BASIC)
      }
      return user
    })
  }

  public async getUserSubscription(userId: string): Promise<Subscription | null> {
    return this.fetchThroughCache(
      cacheService.keys.userSub(userId),
      () => userRepository.findSubscriptionByUserId(userId),
      TTL.USER_SUB,
    )
  }

  public async getUserWithSubscription(id: string) {
    const [user, subscription] = await Promise.all([
      this.getUserById(id),
      this.getUserSubscription(id),
    ])
    if (!user) return null
    return { ...user, subscription }
  }

  public async createUser(data: Prisma.UserCreateInput): Promise<User> {
    return userRepository.create(data)
  }

  public async updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    const currentUser = await this.getUserById(id)
    if (!currentUser) {
      throw new Error("User not found")
    }
    const currentEmail = typeof currentUser.email === "string" ? currentUser.email : undefined

    const basicKey = cacheService.keys.userBasic(id)
    const lockKeys = currentEmail
      ? [basicKey, cacheService.keys.userBasicByEmail(currentEmail)]
      : [basicKey]

    await cacheService.del(this.allKeysFor(id, currentEmail))

    return lockService.executeMulti(lockKeys, async () => {
      const updatedUser = await userRepository.update(id, data)
      const updatedEmail = typeof updatedUser.email === "string" ? updatedUser.email : undefined

      const keysInvalidate = this.allKeysFor(id, currentEmail)
      if (updatedEmail && updatedEmail !== currentEmail) {
        keysInvalidate.push(cacheService.keys.userBasicByEmail(updatedEmail))
      }
      keysInvalidate.push(cacheService.keys.userSub(id))

      await cacheService.del([...new Set(keysInvalidate)])
      delayedDel([...new Set(keysInvalidate)])

      return updatedUser
    })
  }

  public async invalidateUserCache(userId: string, email?: string): Promise<void> {
    const keys = [cacheService.keys.userBasic(userId)]
    if (email) {
      keys.push(cacheService.keys.userBasicByEmail(email))
    }
    const uniq = [...new Set(keys)]
    await cacheService.del(uniq)
    delayedDel(uniq)
  }

  public async invalidateSubscriptionCache(userId: string): Promise<void> {
    await cacheService.del([cacheService.keys.userSub(userId)])
  }

  private allKeysFor(userId: string, email?: string): string[] {
    return [
      cacheService.keys.userBasic(userId),
      cacheService.keys.userSub(userId),
      ...(email ? [cacheService.keys.userBasicByEmail(email)] : []),
    ]
  }

  private async fetchThroughCache<T>(
    key: string,
    fetcher: () => Promise<T | null>,
    ttl: number,
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
        await cacheService.set(key, data, ttl)
      }

      return data
    })
  }
}

export const userService = UserService.getInstance()
