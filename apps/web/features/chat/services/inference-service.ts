/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only"

import { getGrpcClient, getGrpcMetadata } from "@/lib/grpc-client"
import { metrics } from "@/lib/metrics"
import { logger } from "@/lib/logger"
import { AnalysisResult, ModelType } from "../types"

interface ProtoResponse {
  model_name: string
  label: string
  is_ai_generated: boolean
  confidence_score: number
  human_confidence: number
  ai_confidence: number
}

interface ProtoStartedEvent {
  total_chars: number
  total_chunks: number
}

interface ProtoProgressEvent {
  processed_chunks: number
  total_chunks: number
}

interface ProtoStreamEvent {
  event?: "started" | "progress" | "final"
  started?: ProtoStartedEvent
  progress?: ProtoProgressEvent
  final?: ProtoResponse
}

type InferenceStreamEvent =
  | { type: "started"; totalChars: number; totalChunks: number }
  | { type: "progress"; processedChunks: number; totalChunks: number }
  | { type: "final"; result: AnalysisResult }

export class InferenceStreamAbortedError extends Error {
  constructor() {
    super("AI analysis request was canceled")
  }
}

const MODEL_CODES: Record<ModelType, number> = {
  spark: 1,
  flare: 2,
}

const mapProtoResponseToAnalysis = (response: ProtoResponse, model: ModelType): AnalysisResult => {
  const aiScore = response.ai_confidence / 100
  const humanScore = response.human_confidence / 100

  return {
    model,
    label: response.is_ai_generated ? "AI" : "Human",
    confidence: response.confidence_score / 100,
    scores: {
      ai: aiScore,
      human: humanScore,
    },
    raw: {
      ...response,
      processed_at: new Date().toISOString(),
    },
  }
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
          metrics.aiInferenceDuration.observe({ model, status: "error" }, duration)
          logger.error({ msg: "AI Inference Failed", model, error: err })
          reject(new Error("AI Analysis Service Unavailable"))
          return
        }

        metrics.aiInferenceDuration.observe({ model, status: "success" }, duration)
        resolve(mapProtoResponseToAnalysis(response, model))
      })
    })
  },

  async streamDocument(
    text: string,
    model: ModelType,
    handlers: {
      onEvent: (event: InferenceStreamEvent) => void
      signal?: AbortSignal
    }
  ): Promise<void> {
    const client = getGrpcClient()
    const metadata = getGrpcMetadata()
    const start = performance.now()

    return new Promise((resolve, reject) => {
      let settled = false
      const call = client.AnalyzeDocument(
        {
          text,
          model: MODEL_CODES[model],
        },
        metadata,
      )

      const complete = (callback: () => void) => {
        if (settled) {
          return false
        }

        settled = true
        handlers.signal?.removeEventListener("abort", handleAbort)
        callback()
        return true
      }

      const handleAbort = () => {
        call.cancel()
      }

      if (handlers.signal?.aborted) {
        complete(() => {
          metrics.aiInferenceDuration.observe({ model, status: "cancelled" }, (performance.now() - start) / 1000)
          reject(new InferenceStreamAbortedError())
        })
        return
      }

      handlers.signal?.addEventListener("abort", handleAbort, { once: true })

      call.on("data", (event: ProtoStreamEvent) => {
        if (event.event === "started" && event.started) {
          handlers.onEvent({
            type: "started",
            totalChars: event.started.total_chars,
            totalChunks: event.started.total_chunks,
          })
          return
        }

        if (event.event === "progress" && event.progress) {
          handlers.onEvent({
            type: "progress",
            processedChunks: event.progress.processed_chunks,
            totalChunks: event.progress.total_chunks,
          })
          return
        }

        if (event.event === "final" && event.final) {
          handlers.onEvent({
            type: "final",
            result: mapProtoResponseToAnalysis(event.final, model),
          })
        }
      })

      call.on("end", () => {
        if (handlers.signal?.aborted) {
          if (!complete(() => {
            metrics.aiInferenceDuration.observe({ model, status: "cancelled" }, (performance.now() - start) / 1000)
            reject(new InferenceStreamAbortedError())
          })) {
            return
          }

          return
        }

        if (!complete(() => {
          metrics.aiInferenceDuration.observe({ model, status: "success" }, (performance.now() - start) / 1000)
          resolve()
        })) {
          return
        }
      })

      call.on("error", (error: any) => {
        if (handlers.signal?.aborted || error?.code === 1) {
          if (!complete(() => {
            metrics.aiInferenceDuration.observe({ model, status: "cancelled" }, (performance.now() - start) / 1000)
            reject(new InferenceStreamAbortedError())
          })) {
            return
          }

          return
        }

        if (!complete(() => {
          metrics.aiInferenceDuration.observe({ model, status: "error" }, (performance.now() - start) / 1000)
          logger.error({ msg: "AI Streaming Inference Failed", model, error })
          reject(new Error(error?.details || "AI Analysis Service Unavailable"))
        })) {
          return
        }
      })
    })
  },
}
