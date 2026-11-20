import { z } from "zod"

export const ChatAnalyzeRequestSchema = z.object({
  chatId: z.string().min(1),
  content: z.string().min(1),
  model: z.enum(["spark", "flare"]),
  assistantMessageId: z.string().min(1).optional(),
  assistantCreatedAt: z.string().datetime().optional(),
  sourceMessageId: z.string().min(1).optional(),
  userMessageId: z.string().min(1).optional(),
  userCreatedAt: z.string().datetime().optional(),
}).superRefine((value, ctx) => {
  if (!value.sourceMessageId) return
  if (!value.assistantMessageId || !value.assistantCreatedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Retry requests must include assistant message details",
    })
  }
})

export type ChatAnalyzeRequest = z.infer<typeof ChatAnalyzeRequestSchema>
