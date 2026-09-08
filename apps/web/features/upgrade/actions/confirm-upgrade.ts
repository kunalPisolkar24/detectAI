"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/config/auth-options"
import { prisma } from "@/lib/infrastructure/prisma"
import { SubscriptionStatus } from "@/lib/shared/generated/prisma/client"
import { cacheService } from "@/lib/services/cache-service"

export async function confirmUpgradeAction(): Promise<{ isPremium: boolean }> {
  if (process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true") {
    return { isPremium: true }
  }
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { isPremium: false }

  const userId = session.user.id

  for (let attempt = 0; attempt < 10; attempt++) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    })

    if (user?.subscription?.status === SubscriptionStatus.ACTIVE) {
      const keys = [
        cacheService.keys.userSub(userId),
        cacheService.keys.userBasic(userId),
        ...(user.email ? [cacheService.keys.userBasicByEmail(user.email)] : []),
      ]
      await cacheService.del([...new Set(keys)])
      return { isPremium: true }
    }

    await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)))
  }

  return { isPremium: false }
}
