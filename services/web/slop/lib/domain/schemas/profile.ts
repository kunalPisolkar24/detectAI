import { z } from "zod"

export const UpdateProfileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
})

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>
