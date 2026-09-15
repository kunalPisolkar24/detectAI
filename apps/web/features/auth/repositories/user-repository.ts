import { prisma } from "@/lib/infrastructure/prisma"
import { Prisma, User } from "@/lib/shared/generated/prisma/client"

export const userRepository = {
  async findBasicById(id: string) {
    return prisma.user.findUnique({ where: { id } })
  },

  async findBasicByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } })
  },

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
