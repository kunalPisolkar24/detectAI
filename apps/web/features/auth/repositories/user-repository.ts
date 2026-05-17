import { prisma } from "@/lib/infrastructure/prisma"
import { Prisma, User } from "@/lib/shared/generated/prisma/client"

export const userRepository = {
  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      include: {
        subscription: true,
        usage: true
      }
    })
  },

  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      include: {
        subscription: true,
        usage: true
      }
    })
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