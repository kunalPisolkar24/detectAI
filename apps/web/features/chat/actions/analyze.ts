"use server"

import { authOptions } from "@/lib/config/auth-options"
import { getServerSession } from "next-auth"
import { rateLimitService } from "@/features/rate-limit/services/rate-limit-service"
import { MAX_LIVE_ANALYSIS_CHARS } from "../constants"
import { inferenceService } from "../services/inference-service"
import { AnalysisResult, ModelType } from "../types"

export type AnalyzeActionResponse =
  | { success: true, data: AnalysisResult }
  | { success: false, error: string, isRateLimit?: boolean }

export async function analyzeText(content: string, model: ModelType): Promise<AnalyzeActionResponse> {
  // isPremium refreshed via jwt fallback (auth-options.ts) and pendingUpgrade resume; authoritative DB is Subscription.status
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" }
  }

  const { allowed } = await rateLimitService.checkLimit(session.user.id, session.user.isPremium ?? false)

  if (!allowed) {
    return { success: false, error: "Rate limit exceeded", isRateLimit: true }
  }

  if (content.length > MAX_LIVE_ANALYSIS_CHARS) {
    return {
      success: false,
      error: `Text exceeds maximum length of ${MAX_LIVE_ANALYSIS_CHARS} characters`
    }
  }

  try {
    const analysis = await inferenceService.detect(content, model)

    await rateLimitService.trackUsage(session.user.id)

    return { success: true, data: analysis }
  } catch (error) {
    console.error("Analysis Action Error:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to analyze text"
    }
  }
}
