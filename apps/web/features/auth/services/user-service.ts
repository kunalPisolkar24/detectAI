import { cacheService, TTL } from "@/lib/services/cache-service"
import { userRepository } from "@/features/auth/repositories/user-repository"
import { User, Prisma, Subscription } from "@/lib/shared/generated/prisma/client"
import { lockService } from "@/lib/services/lock-service"
import { CacheKeys } from "@/lib/services/cache-keys"

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

  /**
   * Profile row only (no subscription/usage joins). Cached under
   * `user:basic:{id}`. Usage increments never invalidate this key.
   */
  public async getUserById(id: string) {
    return this.fetchThroughCache(
      cacheService.keys.userBasic(id),
      () => userRepository.findBasicById(id),
      TTL.USER_BASIC,
    )
  }

  /**
   * Profile row via email pointer. `user:basic:email:{hash}` stores the user
   * id (not the full object) so id/email entries cannot diverge. Legacy
   * entries holding a full object are still honored during rollout.
   */
  public async getUserByEmail(email: string) {
    const emailKey = cacheService.keys.userBasicByEmail(email)

    const pointer = await cacheService.get<string | User>(emailKey)
    if (pointer) {
      if (typeof pointer === "string") {
        const basic = await this.getUserById(pointer)
        if (basic) return basic
        // Stale pointer (user deleted/renamed) — fall through to DB.
      } else if (typeof pointer === "object" && (pointer as User).id) {
        return pointer as User
      }
    }

    return lockService.execute(emailKey, async () => {
      const doubleCheck = await cacheService.get<string | User>(emailKey)
      if (doubleCheck) {
        if (typeof doubleCheck === "string") {
          const basic = await this.getUserById(doubleCheck)
          if (basic) return basic
        } else if (typeof doubleCheck === "object" && (doubleCheck as User).id) {
          return doubleCheck as User
        }
      }

      const user = await userRepository.findBasicByEmail(email)
      if (user) {
        await cacheService.set(emailKey, user.id, TTL.USER_BASIC)
        await cacheService.set(cacheService.keys.userBasic(user.id), user, TTL.USER_BASIC)
      }
      return user
    })
  }

  /**
   * Subscription row only. Cached under `user:sub:{id}` with a short TTL.
   * Invalidated only by payment webhooks/sweeper — never by usage tracking.
   */
  public async getUserSubscription(userId: string): Promise<Subscription | null> {
    return this.fetchThroughCache(
      cacheService.keys.userSub(userId),
      () => userRepository.findSubscriptionByUserId(userId),
      TTL.USER_SUB,
    )
  }

  /** Composite for callers needing profile + subscription (no usage). */
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
    const subKey = cacheService.keys.userSub(id)
    const lockKeys = currentEmail
      ? [basicKey, cacheService.keys.userBasicByEmail(currentEmail)]
      : [basicKey]

    // Pre-invalidate (DEL → DB → DEL) to shrink the stale-read window where
    // a concurrent reader repopulates between DEL and commit.
    await cacheService.del(this.allKeysFor(id, currentEmail))

    return lockService.executeMulti(lockKeys, async () => {
      const updatedUser = await userRepository.update(id, data)
      const updatedEmail = typeof updatedUser.email === "string" ? updatedUser.email : undefined

      const keysInvalidate = this.allKeysFor(id, currentEmail)
      if (updatedEmail && updatedEmail !== currentEmail) {
        keysInvalidate.push(
          cacheService.keys.userBasicByEmail(updatedEmail),
          // Transitional: new-scheme email may have been read under legacy key.
          CacheKeys.legacy.webUserByEmail(updatedEmail),
          CacheKeys.legacy.workerUserByEmail(updatedEmail),
        )
      }
      // Profile update may also affect derived subscription views — drop sub
      // too so composite readers refill. Usage counters are untouched.
      keysInvalidate.push(subKey)

      await cacheService.del([...new Set(keysInvalidate)])
      delayedDel([...new Set(keysInvalidate)])

      return updatedUser
    })
  }

  /** Profile invalidation only — usage tracking must NOT call this. */
  public async invalidateUserCache(userId: string, email?: string): Promise<void> {
    const keys = [cacheService.keys.userBasic(userId)]
    if (email) {
      keys.push(cacheService.keys.userBasicByEmail(email))
    }
    keys.push(...this.legacyKeysFor(userId, email))
    const uniq = [...new Set(keys)]
    await cacheService.del(uniq)
    delayedDel(uniq)
  }

  /** Subscription invalidation — payment webhooks/sweeper only. */
  public async invalidateSubscriptionCache(userId: string): Promise<void> {
    await cacheService.del([cacheService.keys.userSub(userId)])
  }

  /** Full user invalidation (profile + subscription + legacy). */
  public async invalidateAllUserCache(userId: string, email?: string): Promise<void> {
    const keys = [cacheService.keys.userBasic(userId), cacheService.keys.userSub(userId)]
    if (email) {
      keys.push(cacheService.keys.userBasicByEmail(email))
    }
    keys.push(...this.legacyKeysFor(userId, email))
    const uniq = [...new Set(keys)]
    await cacheService.del(uniq)
    delayedDel(uniq)
  }

  private allKeysFor(userId: string, email?: string): string[] {
    return [
      cacheService.keys.userBasic(userId),
      cacheService.keys.userSub(userId),
      ...(email ? [cacheService.keys.userBasicByEmail(email)] : []),
      ...this.legacyKeysFor(userId, email),
    ]
  }

  private legacyKeysFor(userId: string, email?: string): string[] {
    const keys = [
      CacheKeys.legacy.webUser(userId),
      CacheKeys.legacy.workerUser(userId),
    ]
    if (email) {
      keys.push(
        CacheKeys.legacy.webUserByEmail(email),
        CacheKeys.legacy.workerUserByEmail(email),
      )
    }
    return keys
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
