import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
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

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      image: true,
      createdAt: true,
      paddleSubscriptionStatus: true,
      subscriptionEndsAt: true,
      apiCallCountDaily: true,
      apiCallCountTotal: true,
    }
  })

  if (!user) {
    redirect("/login")
  }

  const isPremium = user.paddleSubscriptionStatus === SubscriptionStatus.ACTIVE

  const userData = {
    ...user,
    isPremium,
    paddleSubscriptionStatus: user.paddleSubscriptionStatus as string | null
  }

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4 md:px-6">
      <ProfileView user={userData} />
    </div>
  )
}