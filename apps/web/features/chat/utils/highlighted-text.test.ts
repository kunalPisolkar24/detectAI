import assert from "node:assert/strict"
import { test } from "node:test"

import { buildHighlightedTextSegments } from "./highlighted-text"

test("builds plain and highlighted segments with uncovered gaps preserved", () => {
  const segments = buildHighlightedTextSegments("Hello there world", [
    {
      charStart: 0,
      charEnd: 5,
      aiConfidence: 0.91,
      label: "AI",
    },
    {
      charStart: 12,
      charEnd: 17,
      aiConfidence: 0.08,
      label: "Human",
    },
  ])

  assert.deepEqual(segments, [
    {
      text: "Hello",
      tone: "AI",
      aiConfidence: 0.91,
    },
    {
      text: " there ",
      tone: "plain",
    },
    {
      text: "world",
      tone: "Human",
      aiConfidence: 0.08,
    },
  ])
})

test("clamps invalid ranges and prevents overlapping highlight duplication", () => {
  const segments = buildHighlightedTextSegments("abcdef", [
    {
      charStart: -5,
      charEnd: 4,
      aiConfidence: 0.75,
      label: "AI",
    },
    {
      charStart: 2,
      charEnd: 10,
      aiConfidence: 0.25,
      label: "Human",
    },
  ])

  assert.deepEqual(segments, [
    {
      text: "abcd",
      tone: "AI",
      aiConfidence: 0.75,
    },
    {
      text: "ef",
      tone: "Human",
      aiConfidence: 0.25,
    },
  ])
})
