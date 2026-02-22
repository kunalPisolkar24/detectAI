import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { userService } from "@/features/auth/services/user-service"
import { rateLimitService } from "@/features/rate-limit/services/rate-limit-service"
import { SubscriptionStatus } from "@/lib/generated/prisma/client"
import { ProfileView } from "@/features/profile/components/profile-view"

export const metadata: Metadata = {
  title: "Profile Settings | Detect AI",
  description: "Manage your account settings and preferences",
}

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/profile")
  }

  const [user, realTimeUsage] = await Promise.all([
    userService.getUserById(session.user.id),
    rateLimitService.getRealTimeUsage(session.user.id)
  ])

  if (!user) {
    redirect("/login")
  }

  const isPremium = user.paddleSubscriptionStatus === SubscriptionStatus.ACTIVE

  const userData = {
    ...user,
    isPremium,
    paddleSubscriptionStatus: user.paddleSubscriptionStatus as string | null,
    paddleCancellationScheduled: user.paddleCancellationScheduled,
    apiCallCountDaily: realTimeUsage.dailyCount,
    apiCallCountTotal: user.apiCallCountTotal + realTimeUsage.pendingCount
  }

  return (
    <div className="flex-1 h-full overflow-y-auto">
      <div className="w-full max-w-[90%] xl:max-w-[1600px] mx-auto py-8 px-4 md:px-8">
        <ProfileView user={userData} />
        <div className="h-20 md:h-0" />
      </div>
    </div>
  )
}