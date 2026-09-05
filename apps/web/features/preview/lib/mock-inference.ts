import type { AnalysisResult, ModelType, AnalysisHighlightSpan } from "@/features/chat/types"

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  }
  return hash
}

const MOCK_HIGHLIGHT_CHARS_PER_SPAN = 180
const MOCK_HIGHLIGHT_MAX_SPANS = 8

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}_]/u.test(char)

/**
 * Snap a candidate range to word boundaries so highlights never cut
 * mid-word (matching the live chunk-level spans). Start moves forward to
 * the next word start, end moves forward to the current word end.
 */
function snapSpanToWordBounds(text: string, start: number, end: number): [number, number] {
  let snappedStart = Math.max(0, Math.min(text.length, start))
  let snappedEnd = Math.max(0, Math.min(text.length, end))

  if (snappedStart > 0 && isWordChar(text[snappedStart - 1]) && isWordChar(text[snappedStart])) {
    while (snappedStart < snappedEnd && isWordChar(text[snappedStart])) snappedStart++
    while (snappedStart < snappedEnd && !isWordChar(text[snappedStart])) snappedStart++
  }

  while (snappedEnd < text.length && isWordChar(text[snappedEnd - 1]) && isWordChar(text[snappedEnd])) snappedEnd++

  return [snappedStart, snappedEnd]
}

function mixHash(base: number, salt: number): number {
  return (Math.imul(base ^ 0x9e3779b9, 31 + salt * 7) + salt * 131) >>> 0
}

/**
 * Build deterministic, non-overlapping, word-aligned highlight spans spread
 * across the full text. Labels mostly follow the overall verdict with a
 * realistic mixed minority, like the live chunk-level confidence map.
 */
function buildMockHighlightSpans(
  text: string,
  model: ModelType,
  overallLabel: "AI" | "Human",
): AnalysisHighlightSpan[] {
  if (!text) return []

  const baseHash = hashString(`${model}:${text.length}:${text.slice(0, 64)}`)
  const spanCount = Math.max(
    1,
    Math.min(MOCK_HIGHLIGHT_MAX_SPANS, Math.floor(text.length / MOCK_HIGHLIGHT_CHARS_PER_SPAN)),
  )
  const windowLength = text.length / spanCount
  const spans: AnalysisHighlightSpan[] = []

  for (let i = 0; i < spanCount; i++) {
    const windowStart = i * windowLength
    const spanHash = mixHash(baseHash, i)
    // Cover the middle ~40% of the window with a small deterministic jitter.
    const jitter = spanHash % Math.max(1, Math.floor(windowLength * 0.08))
    const candidateStart = windowStart + windowLength * 0.3 + jitter
    const candidateEnd = windowStart + windowLength * 0.7 + jitter

    const [charStart, charEnd] = snapSpanToWordBounds(text, Math.floor(candidateStart), Math.floor(candidateEnd))
    if (charEnd <= charStart) continue
    // Guard against overlap with the previous span after word snapping.
    const previous = spans[spans.length - 1]
    const start = previous ? Math.max(charStart, previous.charEnd) : charStart
    if (charEnd <= start) continue

    const followsOverall = spanHash % 10 < 6
    const label = followsOverall ? overallLabel : overallLabel === "AI" ? "Human" : "AI"
    const spanConfidence = 0.55 + (spanHash % 40) / 100

    spans.push({
      charStart: start,
      charEnd,
      aiConfidence: label === "AI" ? spanConfidence : 1 - spanConfidence,
      label,
    })
  }

  return spans
}

export function generateMockAnalysis(text: string, model: ModelType): AnalysisResult {
  const hash = hashString(text + model)
  const isAI = hash % 2 === 0
  const confidence = 0.62 + (hash % 35) / 100 // 0.62 - 0.96
  const aiScore = isAI ? confidence : 1 - confidence
  const humanScore = 1 - aiScore

  const highlights = buildMockHighlightSpans(text, model, isAI ? "AI" : "Human")

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
