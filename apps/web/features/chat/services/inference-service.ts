/* eslint-disable @typescript-eslint/no-explicit-any */
import { getGrpcClient, getGrpcMetadata } from "@/lib/grpc-client"
import { AnalysisResult, ModelType } from "../types"
import { metrics } from "@/lib/metrics"
import { logger } from "@/lib/logger"

interface ProtoResponse {
  model_name: string
  label: string
  is_ai_generated: boolean
  confidence_score: number
  human_confidence: number
  ai_confidence: number
}

export const inferenceService = {
  async detect(text: string, model: ModelType): Promise<AnalysisResult> {
    const client = getGrpcClient()
    const metadata = getGrpcMetadata()

    const method = model === "spark" ? "DetectSpark" : "DetectFlare"
    const start = performance.now()

    return new Promise((resolve, reject) => {
      client[method]({ text }, metadata, (err: any, response: ProtoResponse) => {
        const duration = (performance.now() - start) / 1000

        if (err) {
          metrics.aiInferenceDuration.observe({ model, status: 'error' }, duration)
          logger.error({ msg: "AI Inference Failed", model, error: err })
          reject(new Error("AI Analysis Service Unavailable"))
          return
        }

        metrics.aiInferenceDuration.observe({ model, status: 'success' }, duration)

        const aiScore = response.ai_confidence / 100
        const humanScore = response.human_confidence / 100

        const result: AnalysisResult = {
          model,
          label: response.is_ai_generated ? "AI" : "Human",
          confidence: response.confidence_score / 100,
          scores: {
            ai: aiScore,
            human: humanScore
          },
          raw: {
            ...response,
            processed_at: new Date().toISOString()
          }
        }

        resolve(result)
      })
    })
  }
}