import { redis } from "@/lib/redis"
import { prisma } from "@/lib/prisma"
import { User, Prisma } from "@/lib/generated/prisma/client"

const CACHE_TTL = 3600

export const userService = {
  async getUserById(id: string): Promise<User | null> {
    const cacheKey = `user:id:${id}`
    const cachedUser = await redis.get(cacheKey)

    if (cachedUser) {
      return JSON.parse(cachedUser)
    }

    const user = await prisma.user.findUnique({
      where: { id },
    })

    if (user) {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(user))
    }

    return user
  },

  async getUserByEmail(email: string): Promise<User | null> {
    const cacheKey = `user:email:${email}`
    const cachedUser = await redis.get(cacheKey)

    if (cachedUser) {
      return JSON.parse(cachedUser)
    }

    const user = await prisma.user.findUnique({
      where: { email },
    })

    if (user) {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(user))
      await redis.setex(`user:id:${user.id}`, CACHE_TTL, JSON.stringify(user))
    }

    return user
  },

  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    const user = await prisma.user.create({
      data,
    })

    const idKey = `user:id:${user.id}`
    const emailKey = `user:email:${user.email}`

    await Promise.all([
      redis.setex(idKey, CACHE_TTL, JSON.stringify(user)),
      redis.setex(emailKey, CACHE_TTL, JSON.stringify(user))
    ])

    return user
  },

  async updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    const user = await prisma.user.update({
      where: { id },
      data,
    })

    const idKey = `user:id:${user.id}`
    const emailKey = `user:email:${user.email}`

    await Promise.all([
      redis.del(idKey),
      redis.del(emailKey)
    ])

    await Promise.all([
      redis.setex(idKey, CACHE_TTL, JSON.stringify(user)),
      redis.setex(emailKey, CACHE_TTL, JSON.stringify(user))
    ])

    return user
  },

  async invalidateUserCache(userId: string, email?: string) {
    const keys = [`user:id:${userId}`]
    if (email) keys.push(`user:email:${email}`)
    await redis.del(...keys)
  }
}