import { AnalysisHighlightSpan } from "../types"

export interface HighlightedTextSegment {
  text: string
  tone: "plain" | "AI" | "Human"
  aiConfidence?: number
}

const normalizeHighlights = (
  sourceText: string,
  highlights: AnalysisHighlightSpan[],
): AnalysisHighlightSpan[] =>
  [...highlights]
    .sort((left, right) => left.charStart - right.charStart)
    .flatMap((highlight): AnalysisHighlightSpan[] => {
      const charStart = Math.max(0, Math.min(sourceText.length, highlight.charStart))
      const charEnd = Math.max(charStart, Math.min(sourceText.length, highlight.charEnd))

      if (charEnd <= charStart) {
        return []
      }

      return [{
        ...highlight,
        charStart,
        charEnd,
      }]
    })

export const buildHighlightedTextSegments = (
  sourceText: string,
  highlights: AnalysisHighlightSpan[],
): HighlightedTextSegment[] => {
  if (!sourceText) {
    return []
  }

  const segments: HighlightedTextSegment[] = []
  let cursor = 0

  for (const highlight of normalizeHighlights(sourceText, highlights)) {
    if (highlight.charStart > cursor) {
      segments.push({
        text: sourceText.slice(cursor, highlight.charStart),
        tone: "plain",
      })
    }

    const start = Math.max(cursor, highlight.charStart)
    const end = Math.max(start, highlight.charEnd)

    if (end > start) {
      segments.push({
        text: sourceText.slice(start, end),
        tone: highlight.label,
        aiConfidence: highlight.aiConfidence,
      })
      cursor = end
    }
  }

  if (cursor < sourceText.length) {
    segments.push({
      text: sourceText.slice(cursor),
      tone: "plain",
    })
  }

  return segments.filter((segment) => segment.text.length > 0)
}
