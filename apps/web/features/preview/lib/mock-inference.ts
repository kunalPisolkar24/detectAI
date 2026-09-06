import type { AnalysisResult, ModelType, AnalysisHighlightSpan } from "@/features/chat/types"

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  }
  return hash
}

// Mirrors the live pipeline (services/inference): 256 tokens / 192 stride at
// ~4 chars per token. Offsets are raw window boundaries — like the backend,
// spans may cut mid-word; that is authentic, not a bug.
const MOCK_CHUNK_CHARS = 1000
const MOCK_STRIDE_CHARS = 770
const MOCK_AI_THRESHOLD = 0.5

/** Deterministic PRNG so identical inputs always yield identical analyses. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface MockChunk {
  charStart: number
  charEnd: number
  probability: number
}

/**
 * Sliding char windows with per-chunk AI probabilities grouped into coherent
 * regions — verdict flips happen at region edges, never at arbitrary points.
 */
function planMockChunks(text: string, rand: () => number): MockChunk[] {
  const chunks: MockChunk[] = []
  for (let start = 0; start < text.length; start += MOCK_STRIDE_CHARS) {
    const end = Math.min(text.length, start + MOCK_CHUNK_CHARS)
    if (end <= start) break
    chunks.push({ charStart: start, charEnd: end, probability: 0 })
  }
  if (chunks.length === 0) return chunks

  const roll = rand()
  let regionCount: number
  if (roll < 0.45) {
    regionCount = 1 + Math.floor(rand() * 2) // mostly AI: 1-2 AI regions
  } else if (roll < 0.9) {
    regionCount = rand() < 0.5 ? 0 : 1 // mostly human: 0-1 AI regions
  } else {
    regionCount = 2 + Math.floor(rand() * 2) // mixed: 2-3 AI regions
  }

  const regions: Array<[number, number]> = []
  for (let i = 0; i < regionCount; i++) {
    const center = rand() * text.length
    const width = text.length * (0.15 + rand() * 0.35)
    regions.push([center - width / 2, center + width / 2])
  }

  for (const chunk of chunks) {
    const midpoint = (chunk.charStart + chunk.charEnd) / 2
    const inRegion = regions.some(([start, end]) => midpoint >= start && midpoint <= end)
    chunk.probability = inRegion
      ? 0.68 + rand() * 0.27 // 0.68 - 0.95: firmly AI, never flips alone
      : 0.05 + rand() * 0.35 // 0.05 - 0.40: firmly human, never flips alone
  }

  return chunks
}

/**
 * Sweep unique chunk boundaries, average overlapping probabilities per
 * interval, then merge adjacent same-label intervals with length-weighted
 * probability — the same algorithm as the live aggregator.
 */
function sweepAndMerge(chunks: MockChunk[]): AnalysisHighlightSpan[] {
  const boundaries = new Set<number>()
  for (const chunk of chunks) {
    boundaries.add(chunk.charStart)
    boundaries.add(chunk.charEnd)
  }
  const sorted = [...boundaries].sort((a, b) => a - b)

  const merged: Array<{ start: number; end: number; p: number }> = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i]
    const end = sorted[i + 1]
    if (end <= start) continue
    let weightSum = 0
    let probSum = 0
    for (const chunk of chunks) {
      if (chunk.charStart <= start && chunk.charEnd >= end) {
        const weight = end - start
        weightSum += weight
        probSum += chunk.probability * weight
      }
    }
    if (weightSum <= 0) continue
    const p = probSum / weightSum
    const last = merged[merged.length - 1]
    const sameLabel =
      last !== undefined &&
      (last.p >= MOCK_AI_THRESHOLD) === (p >= MOCK_AI_THRESHOLD)
    if (last && last.end === start && sameLabel) {
      const lastLen = last.end - last.start
      const nextLen = end - start
      last.p = (last.p * lastLen + p * nextLen) / (lastLen + nextLen)
      last.end = end
    } else {
      merged.push({ start, end, p })
    }
  }

  // Proto rounds to 1 decimal on the 0-100 scale → 3 decimals domain-side.
  return merged.map((interval) => ({
    charStart: interval.start,
    charEnd: interval.end,
    aiConfidence: Math.round(interval.p * 1000) / 1000,
    label: interval.p >= MOCK_AI_THRESHOLD ? "AI" : "Human",
  }))
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000

export function generateMockAnalysis(text: string, model: ModelType): AnalysisResult {
  if (!text) {
    return {
      model,
      label: "Human",
      confidence: 0.5,
      scores: { ai: 0.5, human: 0.5 },
      highlights: [],
      raw: {
        mock: true,
        model,
        generatedAt: new Date().toISOString(),
        textLength: 0,
      },
    }
  }

  const rand = mulberry32(hashString(`${text}:${model}`))
  const chunks = planMockChunks(text, rand)
  const highlights = sweepAndMerge(chunks)

  // Overall verdict derived from the same chunk probabilities (overlap
  // counted once — sweep intervals never overlap), so the headline can never
  // contradict the confidence map. Mirrors doc scoring (strict > 0.5).
  let covered = 0
  let weighted = 0
  for (const span of highlights) {
    const length = span.charEnd - span.charStart
    covered += length
    weighted += span.aiConfidence * length
  }
  const aiScore = covered > 0 ? round3(weighted / covered) : 0.5
  const humanScore = round3(1 - aiScore)
  const label = aiScore > 0.5 ? "AI" : "Human"
  const confidence = Math.max(aiScore, humanScore)

  return {
    model,
    label,
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
