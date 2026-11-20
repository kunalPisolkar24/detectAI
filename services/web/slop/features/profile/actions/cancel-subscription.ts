"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/config/auth-options"
import { prisma } from "@/lib/infrastructure/prisma"
import { SubscriptionStatus } from "@/lib/shared/generated/prisma/client"
import { env } from "@/lib/config/env"
import { userService } from "@/lib/application/user-service"
import { isPreviewMode } from "@/lib/config/preview"

type ActionState = {
  success?: boolean
  error?: string
}

export async function cancelSubscriptionAction(): Promise<ActionState> {
  if (isPreviewMode()) {
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

    // Contact gateway first — only mark scheduled if provider confirms, so we
    // never leave cancellationScheduled:true while gateway was never told
    // (the partial-payment bug when fetch throws and skips the rollback).
    let gatewayOk = false
    try {
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
        console.error(`Gateway Error: ${response.statusText}`)
        return { error: "Failed to communicate with payment provider. Please try again." }
      }
      gatewayOk = true
    } catch (error) {
      console.error("Gateway fetch failed:", error)
      return { error: "Failed to communicate with payment provider. Please try again." }
    }

    if (!gatewayOk) {
      return { error: "Failed to communicate with payment provider. Please try again." }
    }

    await prisma.subscription.update({
      where: { userId },
      data: { cancellationScheduled: true }
    })

    await userService.invalidateUserCache(userId, user.email)

    revalidatePath("/profile")
    return { success: true }

  } catch (error) {
    console.error("Cancellation Action Error:", error)
    return { error: "An unexpected error occurred." }
  }
}