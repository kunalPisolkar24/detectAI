import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/config/auth-options"
import { userService } from "@/features/auth/services/user-service"
import { rateLimitService } from "@/features/rate-limit/services/rate-limit-service"
import { SubscriptionStatus } from "@/lib/shared/generated/prisma/client"
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

  if (process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true") {
    // Mock user data from session + local premium flag is handled client-side;
    // server renders a neutral preview snapshot (premium false). Client then upgrades via localStorage.
    const isPreviewPremium = false // client will override via useEffect
    const now = new Date()
    const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const email = session.user.email ?? "preview@example.com"
    const name = session.user.name ?? email.split("@")[0]
    const parts = name.split(" ")
    const userData = {
      id: session.user.id,
      firstName: parts[0] ?? "Preview",
      lastName: parts.slice(1).join(" ") || "User",
      email,
      image: session.user.image ?? null,
      createdAt: now,
      isPremium: isPreviewPremium,
      subscriptionEndsAt: isPreviewPremium ? endsAt : null,
      paddleSubscriptionStatus: isPreviewPremium ? "ACTIVE" : null,
      paddleCancellationScheduled: false,
      apiCallCountDaily: 12,
      apiCallCountTotal: 340,
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

  // DB-authoritative read (never stale); chat gate relies on session.user.isPremium refreshed via jwt fallback
  const [user, realTimeUsage] = await Promise.all([
    userService.getUserById(session.user.id),
    rateLimitService.getRealTimeUsage(session.user.id)
  ])

  if (!user) {
    redirect("/login")
  }

  const isPremium = user.subscription?.status === SubscriptionStatus.ACTIVE

  const userData = {
    ...user,
    isPremium,
    subscriptionEndsAt: user.subscription?.endsAt ?? null,
    paddleSubscriptionStatus: user.subscription?.status as string | null,
    paddleCancellationScheduled: user.subscription?.cancellationScheduled ?? false,
    apiCallCountDaily: realTimeUsage.dailyCount,
    apiCallCountTotal: user.usage?.apiCallCountTotal ?? 0
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