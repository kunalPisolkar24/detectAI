import { prisma } from "@/lib/infrastructure/prisma"
import { Prisma, User } from "@/lib/shared/generated/prisma/client"

export const userRepository = {
  /**
   * @deprecated pre-split blob (user+subscription+usage). Usage increments
   * must NOT invalidate user cache — prefer findBasicById and findSubscription.
   * Kept for rolling-deploy compatibility.
   */
  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      include: {
        subscription: true,
        usage: true
      }
    })
  },

  /** @deprecated see findById — prefer findBasicByEmail + findSubscription. */
  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      include: {
        subscription: true,
        usage: true
      }
    })
  },

  /** Profile row only — cached under `user:basic:{id}` (TTL 3600). */
  async findBasicById(id: string) {
    return prisma.user.findUnique({ where: { id } })
  },

  /** Profile row only — cached under `user:basic:email:{hash}` + id pointer. */
  async findBasicByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } })
  },

  /** Subscription row only — cached under `user:sub:{id}` (TTL 600). */
  async findSubscriptionByUserId(userId: string) {
    return prisma.subscription.findUnique({ where: { userId } })
  },

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({
      data,
    })
  },

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({
      where: { id },
      data,
    })
  }
}