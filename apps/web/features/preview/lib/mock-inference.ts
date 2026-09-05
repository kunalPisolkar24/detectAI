import type { AnalysisResult, ModelType, AnalysisHighlightSpan } from "@/features/chat/types"

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  }
  return hash
}

export function generateMockAnalysis(text: string, model: ModelType): AnalysisResult {
  const hash = hashString(text + model)
  const isAI = hash % 2 === 0
  const confidence = 0.62 + (hash % 35) / 100 // 0.62 - 0.96
  const aiScore = isAI ? confidence : 1 - confidence
  const humanScore = 1 - aiScore

  const highlights: AnalysisHighlightSpan[] = []
  if (text.length > 80) {
    const spanCount = Math.min(3, Math.floor(text.length / 120) + 1)
    const chunk = Math.floor(text.length / (spanCount + 1))
    for (let i = 0; i < spanCount; i++) {
      const start = i * chunk + 10 + (hash % 20)
      const end = Math.min(text.length, start + 40 + (hash % 60))
      if (start < end) {
        const spanConfidence = 0.55 + ((hash + i * 13) % 40) / 100
        highlights.push({
          charStart: start,
          charEnd: end,
          aiConfidence: isAI ? spanConfidence : 1 - spanConfidence,
          label: isAI ? "AI" : "Human",
        })
      }
    }
  }

  return {
    model,
    label: isAI ? "AI" : "Human",
    confidence,
    scores: { ai: aiScore, human: humanScore },
    highlights,
    raw: {
      mock: true,
      model,
      generatedAt: new Date().toISOString(),
      textLength: text.length,
    },
  }
}

export type MockStreamEvent =
  | { type: "started"; totalChars: number; totalChunks: number }
  | { type: "progress"; processedChunks: number; totalChunks: number }
  | { type: "final"; result: AnalysisResult }

export async function mockStreamDocument(
  text: string,
  model: ModelType,
  handlers: { onEvent: (e: MockStreamEvent) => void; signal?: AbortSignal },
): Promise<void> {
  const totalChars = text.length
  const totalChunks = Math.max(1, Math.min(5, Math.ceil(totalChars / 800) + 1))

  if (handlers.signal?.aborted) throw new DOMException("Aborted", "AbortError")

  handlers.onEvent({ type: "started", totalChars, totalChunks })

  for (let i = 1; i <= totalChunks; i++) {
    if (handlers.signal?.aborted) throw new DOMException("Aborted", "AbortError")
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 350 + (hashString(text) % 250))
      handlers.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          reject(new DOMException("Aborted", "AbortError"))
        },
        { once: true },
      )
    })
    if (handlers.signal?.aborted) throw new DOMException("Aborted", "AbortError")
    if (i < totalChunks) {
      handlers.onEvent({ type: "progress", processedChunks: i, totalChunks })
    } else {
      const result = generateMockAnalysis(text, model)
      handlers.onEvent({ type: "final", result })
    }
  }
}
