"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/config/auth-options"
import { userService } from "@/lib/application/user-service"
import { isPreviewMode } from "@/lib/config/preview"
import { UpdateProfileSchema } from "@/lib/domain/schemas/profile"
import type { UpdateProfileInput } from "@/lib/domain/schemas/profile"

export async function updateProfileAction(values: UpdateProfileInput) {
  if (isPreviewMode()) {
    return { success: true }
  }
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return { error: "Unauthorized" }
  }

  const validated = UpdateProfileSchema.safeParse(values)

  if (!validated.success) {
    return { error: "Invalid input" }
  }

  const { firstName, lastName } = validated.data

  try {
    await userService.updateUser(session.user.id, {
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
    })

    revalidatePath("/profile")
    return { success: true }
  } catch (error) {
    console.error("Profile update error:", error)
    return { error: "Failed to update profile" }
  }
}