"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"

const UpdateProfileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
})

export async function updateProfileAction(values: z.infer<typeof UpdateProfileSchema>) {
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
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        firstName,
        lastName,
        name: `${firstName} ${lastName}`.trim(),
      },
    })

    revalidatePath("/profile")
    return { success: true }
  } catch (error) {
    console.error("Profile update error:", error)
    return { error: "Failed to update profile" }
  }
}