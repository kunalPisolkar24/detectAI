import { describe, expect, it } from "vitest"

import { buildHighlightedTextSegments } from "@/features/chat/utils/highlighted-text"
import { generateMockAnalysis } from "@/features/preview/lib/mock-inference"

const SAMPLE_TEXT =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. ".repeat(
    3,
  )

const coveredLength = (highlights: Array<{ charStart: number; charEnd: number }>): number =>
  highlights.reduce((total, span) => total + (span.charEnd - span.charStart), 0)

describe("generateMockAnalysis highlights", () => {
  it("produces bounded, sorted, non-overlapping spans", () => {
    for (const model of ["spark", "flare"] as const) {
      const { highlights } = generateMockAnalysis(SAMPLE_TEXT, model)

      expect(highlights.length).toBeGreaterThan(0)

      for (const span of highlights) {
        expect(span.charStart).toBeGreaterThanOrEqual(0)
        expect(span.charEnd).toBeLessThanOrEqual(SAMPLE_TEXT.length)
        expect(span.charEnd).toBeGreaterThan(span.charStart)
        expect(["AI", "Human"]).toContain(span.label)
        expect(span.aiConfidence).toBeGreaterThanOrEqual(0)
        expect(span.aiConfidence).toBeLessThanOrEqual(1)
      }

      const starts = highlights.map((span) => span.charStart)
      expect([...starts].sort((a, b) => a - b)).toEqual(starts)

      for (let i = 1; i < highlights.length; i++) {
        expect(highlights[i].charStart).toBeGreaterThanOrEqual(highlights[i - 1].charEnd)
      }
    }
  })

  it("covers (nearly) the whole text like the live confidence map", () => {
    for (const model of ["spark", "flare"] as const) {
      const { highlights } = generateMockAnalysis(SAMPLE_TEXT, model)
      expect(coveredLength(highlights) / SAMPLE_TEXT.length).toBeGreaterThanOrEqual(0.9)
    }
  })

  it("merges adjacent same-label intervals so neighbors always differ", () => {
    const { highlights } = generateMockAnalysis(SAMPLE_TEXT, "spark")
    expect(highlights.length).toBeGreaterThan(0)

    for (let i = 1; i < highlights.length; i++) {
      expect(highlights[i].label).not.toBe(highlights[i - 1].label)
    }
  })

  it("keeps the headline consistent with the confidence map", () => {
    for (const model of ["spark", "flare"] as const) {
      const result = generateMockAnalysis(SAMPLE_TEXT, model)

      expect(result.scores.ai + result.scores.human).toBeCloseTo(1, 10)
      expect(result.confidence).toBe(Math.max(result.scores.ai, result.scores.human))
      if (result.label === "AI") {
        expect(result.scores.ai).toBeGreaterThanOrEqual(result.scores.human)
      } else {
        expect(result.scores.human).toBeGreaterThanOrEqual(result.scores.ai)
      }
      for (const span of result.highlights) {
        if (span.label === "AI") {
          expect(span.aiConfidence).toBeGreaterThanOrEqual(0.5)
        } else {
          expect(span.aiConfidence).toBeLessThanOrEqual(0.5)
        }
      }
    }
  })

  it("is deterministic for the same input", () => {
    const first = generateMockAnalysis(SAMPLE_TEXT, "spark")
    const second = generateMockAnalysis(SAMPLE_TEXT, "spark")

    expect(second.highlights).toEqual(first.highlights)
    expect(second.scores).toEqual(first.scores)
    expect(second.label).toBe(first.label)
    expect(second.confidence).toBe(first.confidence)
    expect(second.model).toBe(first.model)
  })

  it("covers short texts with a single span", () => {
    const text = "Hello world, this is a short sample."
    const { highlights } = generateMockAnalysis(text, "spark")

    expect(highlights).toHaveLength(1)
    expect(highlights[0].charStart).toBe(0)
    expect(highlights[0].charEnd).toBe(text.length)
  })

  it("handles empty text without spans", () => {
    const result = generateMockAnalysis("", "spark")

    expect(result.highlights).toEqual([])
    expect(result.scores.ai + result.scores.human).toBeCloseTo(1, 10)
  })

  it("renders the full source text through the highlight panel segments", () => {
    const { highlights } = generateMockAnalysis(SAMPLE_TEXT, "spark")
    const segments = buildHighlightedTextSegments(SAMPLE_TEXT, highlights)

    expect(segments.length).toBeGreaterThan(0)
    expect(segments.map((segment) => segment.text).join("")).toBe(SAMPLE_TEXT)
    expect(segments.some((segment) => segment.tone !== "plain")).toBe(true)
  })
})
