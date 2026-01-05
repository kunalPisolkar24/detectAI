import { redis } from "@/lib/redis"
import { userRepository } from "@/features/auth/repositories/user-repository"
import { User, Prisma } from "@/lib/generated/prisma/client"
import { JsonSerializer } from "@/lib/serialization"

const CACHE_TTL = 3600

export const userService = {
  async getUserById(id: string): Promise<User | null> {
    const cacheKey = `user:id:${id}`
    
    try {
      const cachedUser = await redis.get(cacheKey)
      if (cachedUser) {
        return JsonSerializer.deserialize<User>(cachedUser)
      }
    } catch (error) {
      console.error("Redis error:", error)
    }

    const user = await userRepository.findById(id)

    if (user) {
      try {
        await redis.setex(cacheKey, CACHE_TTL, JsonSerializer.serialize(user))
      } catch (error) {
        console.error("Redis set error:", error)
      }
    }

    return user
  },

  async getUserByEmail(email: string): Promise<User | null> {
    const cacheKey = `user:email:${email}`

    try {
      const cachedUser = await redis.get(cacheKey)
      if (cachedUser) {
        return JsonSerializer.deserialize<User>(cachedUser)
      }
    } catch (error) {
      console.error("Redis error:", error)
    }

    const user = await userRepository.findByEmail(email)

    if (user) {
      try {
        const serializedUser = JsonSerializer.serialize(user)
        await Promise.all([
          redis.setex(cacheKey, CACHE_TTL, serializedUser),
          redis.setex(`user:id:${user.id}`, CACHE_TTL, serializedUser)
        ])
      } catch (error) {
        console.error("Redis set error:", error)
      }
    }

    return user
  },

  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    const user = await userRepository.create(data)
    return user
  },

  async updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    const user = await userRepository.update(id, data)

    const keys = [`user:id:${id}`, `user:email:${user.email}`]
    
    try {
      await redis.del(...keys)
    } catch (error) {
      console.error("Redis deletion error:", error)
    }

    return user
  },

  async invalidateUserCache(userId: string, email?: string) {
    const keys = [`user:id:${userId}`]
    if (email) keys.push(`user:email:${email}`)
    
    try {
      await redis.del(...keys)
    } catch (error) {
      console.error("Redis error:", error)
    }
  }
}