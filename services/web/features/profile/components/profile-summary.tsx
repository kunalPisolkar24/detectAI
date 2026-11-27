"use client"

import { useMe } from "@/features/profile/hooks/use-me"

export function ProfileSummary() {
  const { data: user, isPending, error } = useMe()

  if (isPending) return <p className="text-muted-foreground">Loading profile...</p>
  if (error || !user) return <p className="text-destructive">Unable to load profile.</p>

  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold">{user.name}</h1>
      <p className="text-muted-foreground">{user.email}</p>
    </div>
  )
}
