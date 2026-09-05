"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/config/auth-options"
import { prisma } from "@/lib/infrastructure/prisma"
import { SubscriptionStatus } from "@/lib/shared/generated/prisma/client"
import { env } from "@/lib/config/env"
import { userService } from "@/features/auth/services/user-service"

type ActionState = {
  success?: boolean
  error?: string
}

export async function cancelSubscriptionAction(): Promise<ActionState> {
  if (process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true") {
    return { success: true }
  }
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return { error: "Unauthorized" }
    }

    const userId = session.user.id

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        subscription: {
          select: {
            paddleSubscriptionId: true,
            status: true
          }
        }
      },
    })

    if (!user || !user.subscription?.paddleSubscriptionId) {
      return { error: "No active subscription details found." }
    }

    const isActive =
      user.subscription.status === SubscriptionStatus.ACTIVE ||
      user.subscription.status === SubscriptionStatus.TRIALING

    if (!isActive) {
      return { error: "Subscription is already inactive." }
    }

    await prisma.subscription.update({
      where: { userId },
      data: { cancellationScheduled: true }
    })

    await userService.invalidateUserCache(userId, user.email)

    const response = await fetch(`${env.PAYMENT_GATEWAY_URL}/internal/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": env.INTERNAL_API_KEY || "",
      },
      body: JSON.stringify({
        event_id: `evt_internal_${crypto.randomUUID()}`,
        event_type: "user.cancel_subscription",
        occurred_at: new Date().toISOString(),
        notification_id: `internal_${userId}_${Date.now()}`,
        data: {
          userId: userId,
          paddleSubscriptionId: user.subscription.paddleSubscriptionId,
          custom_data: { userId },
        }
      }),
    })

    if (!response.ok) {
      await prisma.subscription.update({
        where: { userId },
        data: { cancellationScheduled: false }
      })
      await userService.invalidateUserCache(userId, user.email)
      console.error(`Gateway Error: ${response.statusText}`)
      return { error: "Failed to communicate with payment provider. Please try again." }
    }

    revalidatePath("/profile")
    return { success: true }

  } catch (error) {
    console.error("Cancellation Action Error:", error)
    return { error: "An unexpected error occurred." }
  }
}