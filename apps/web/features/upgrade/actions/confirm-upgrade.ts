"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/config/auth-options"
import { prisma } from "@/lib/infrastructure/prisma"
import { SubscriptionStatus } from "@/lib/shared/generated/prisma/client"
import { cacheService } from "@/lib/services/cache-service"

export async function checkSubscriptionOnce(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  })
  return user?.subscription?.status === SubscriptionStatus.ACTIVE
}

export async function confirmUpgradeAction(): Promise<{ isPremium: boolean }> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { isPremium: false }

  const userId = session.user.id

  for (let attempt = 0; attempt < 10; attempt++) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    })

    if (user?.subscription?.status === SubscriptionStatus.ACTIVE) {
      await cacheService.del(cacheService.keys.user(userId))
      if (user.email) await cacheService.del(cacheService.keys.userByEmail(user.email))
      return { isPremium: true }
    }

    await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)))
  }

  return { isPremium: false }
}
