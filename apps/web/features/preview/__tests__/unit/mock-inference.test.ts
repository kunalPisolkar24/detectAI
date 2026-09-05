import { describe, expect, it } from "vitest"

import { buildHighlightedTextSegments } from "@/features/chat/utils/highlighted-text"
import { generateMockAnalysis } from "@/features/preview/lib/mock-inference"

const SAMPLE_TEXT =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. ".repeat(
    3,
  )

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}_]/u.test(char)

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

  it("aligns spans to word boundaries", () => {
    const { highlights } = generateMockAnalysis(SAMPLE_TEXT, "spark")
    expect(highlights.length).toBeGreaterThan(0)

    for (const span of highlights) {
      const cutsWordAtStart =
        span.charStart > 0 &&
        isWordChar(SAMPLE_TEXT[span.charStart - 1]) &&
        isWordChar(SAMPLE_TEXT[span.charStart])
      const cutsWordAtEnd =
        span.charEnd < SAMPLE_TEXT.length &&
        isWordChar(SAMPLE_TEXT[span.charEnd - 1]) &&
        isWordChar(SAMPLE_TEXT[span.charEnd])

      expect(cutsWordAtStart).toBe(false)
      expect(cutsWordAtEnd).toBe(false)
    }
  })

  it("keeps span labels consistent with their confidence", () => {
    const { highlights } = generateMockAnalysis(SAMPLE_TEXT, "flare")

    for (const span of highlights) {
      if (span.label === "AI") {
        expect(span.aiConfidence).toBeGreaterThanOrEqual(0.5)
      } else {
        expect(span.aiConfidence).toBeLessThanOrEqual(0.5)
      }
    }
  })

  it("is deterministic for the same input", () => {
    const first = generateMockAnalysis(SAMPLE_TEXT, "spark")
    const second = generateMockAnalysis(SAMPLE_TEXT, "spark")

    expect(second.highlights).toEqual(first.highlights)
    expect(second.label).toBe(first.label)
  })

  it("still highlights short texts", () => {
    const { highlights } = generateMockAnalysis("Hello world, this is a short sample.", "spark")
    expect(highlights.length).toBeGreaterThan(0)
  })

  it("renders the full source text through the highlight panel segments", () => {
    const { highlights } = generateMockAnalysis(SAMPLE_TEXT, "spark")
    const segments = buildHighlightedTextSegments(SAMPLE_TEXT, highlights)

    expect(segments.length).toBeGreaterThan(0)
    expect(segments.map((segment) => segment.text).join("")).toBe(SAMPLE_TEXT)
    expect(segments.some((segment) => segment.tone !== "plain")).toBe(true)
  })
})
