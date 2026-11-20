import { expect, test } from "vitest"

import type { Message } from "../../../types"
import {
  buildAnalysisMessageMetadata,
  parseAnalysisHighlightsMetadata,
  parseAnalysisLinkMetadata,
  parseAnalysisMessageMetadata,
} from "../../../utils/analysis-message-metadata"
import { orderMessagesForDisplay } from "../../../utils/order-messages-for-display"

const createMessage = ({
  id,
  role,
  content,
  analysisLink,
  analysisStatus,
  streamingProgress,
  createdAt,
}: Pick<Message, "id" | "role" | "content"> &
  Pick<Partial<Message>, "analysisLink" | "analysisStatus" | "streamingProgress"> & {
    createdAt?: Date
  }): Message => ({
  id,
  role,
  content,
  analysisLink,
  analysisStatus,
  streamingProgress,
  createdAt: createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
})

test("reorders a linked assistant analysis ahead of its source input", () => {
  const orderedMessages = orderMessagesForDisplay([
    createMessage({
      id: "assistant-1",
      role: "assistant",
      content: "",
      analysisLink: {
        state: "completed",
        model: "spark",
        sourceMessageId: "user-1",
      },
    }),
    createMessage({
      id: "user-1",
      role: "user",
      content: "Analyze this text",
    }),
  ])

  expect(orderedMessages.map((message) => message.id)).toEqual(
    ["user-1", "assistant-1"],
  )
})

test("keeps an already-correct source and analysis pair in place", () => {
  const orderedMessages = orderMessagesForDisplay([
    createMessage({
      id: "user-1",
      role: "user",
      content: "Analyze this text",
    }),
    createMessage({
      id: "assistant-1",
      role: "assistant",
      content: "",
      analysisLink: {
        state: "completed",
        model: "spark",
        sourceMessageId: "user-1",
      },
    }),
  ])

  expect(orderedMessages.map((message) => message.id)).toEqual(
    ["user-1", "assistant-1"],
  )
})

test("leaves an assistant analysis in baseline order when the source message is missing", () => {
  const orderedMessages = orderMessagesForDisplay([
    createMessage({
      id: "user-1",
      role: "user",
      content: "Analyze this text",
    }),
    createMessage({
      id: "assistant-1",
      role: "assistant",
      content: "",
      analysisLink: {
        state: "completed",
        model: "spark",
        sourceMessageId: "missing-user",
      },
    }),
  ])

  expect(orderedMessages.map((message) => message.id)).toEqual(
    ["user-1", "assistant-1"],
  )
})

test("keeps a streaming progress card after its source text", () => {
  const orderedMessages = orderMessagesForDisplay([
    createMessage({
      id: "user-1",
      role: "user",
      content: "Analyze this text",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
    createMessage({
      id: "assistant-1",
      role: "assistant",
      content: "",
      createdAt: new Date("2026-01-01T00:00:00.001Z"),
      analysisStatus: {
        state: "running",
        model: "spark",
        sourceMessageId: "user-1",
      },
      streamingProgress: {
        model: "spark",
        processedChunks: 0,
        totalChunks: 0,
        status: "running",
        retryContent: "Analyze this text",
        sourceMessageId: "user-1",
      },
    }),
  ])

  expect(orderedMessages.map((message) => message.id)).toEqual(
    ["user-1", "assistant-1"],
  )
})

test("keeps a linked streaming card after its source regardless of input direction", () => {
  const user = createMessage({
    id: "user-1",
    role: "user",
    content: "Analyze this text",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  })
  const assistant = createMessage({
    id: "assistant-1",
    role: "assistant",
    content: "",
    createdAt: new Date("2026-01-01T00:00:00.001Z"),
    streamingProgress: {
      model: "spark",
      processedChunks: 1,
      totalChunks: 3,
      status: "running",
      retryContent: "Analyze this text",
      sourceMessageId: "user-1",
    },
  })

  expect(orderMessagesForDisplay([assistant, user]).map((message) => message.id)).toEqual(
    ["user-1", "assistant-1"],
  )
  expect(orderMessagesForDisplay([user, assistant]).map((message) => message.id)).toEqual(
    ["user-1", "assistant-1"],
  )
})

test("ordering is idempotent for completed pairs", () => {
  const user = createMessage({
    id: "user-1",
    role: "user",
    content: "Analyze this text",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  })
  const assistant = createMessage({
    id: "assistant-1",
    role: "assistant",
    content: "",
    createdAt: new Date("2026-01-01T00:00:00.001Z"),
    analysisLink: {
      state: "completed",
      model: "spark",
      sourceMessageId: "user-1",
    },
  })

  const once = orderMessagesForDisplay([user, assistant])
  const twice = orderMessagesForDisplay(once)

  expect(once.map((message) => message.id)).toEqual(["user-1", "assistant-1"])
  expect(twice.map((message) => message.id)).toEqual(["user-1", "assistant-1"])
})

test("keeps insertion order for an unlinked streaming card", () => {
  const orderedMessages = orderMessagesForDisplay([
    createMessage({
      id: "user-1",
      role: "user",
      content: "Analyze this text",
    }),
    createMessage({
      id: "assistant-1",
      role: "assistant",
      content: "",
      streamingProgress: {
        model: "spark",
        processedChunks: 0,
        totalChunks: 0,
        status: "running",
        retryContent: "Analyze this text",
      },
    }),
  ])

  expect(orderedMessages.map((message) => message.id)).toEqual(
    ["user-1", "assistant-1"],
  )
})

test("completed analysis metadata still yields an analysis link", () => {
  const metadata = buildAnalysisMessageMetadata({
    state: "completed",
    model: "flare",
    sourceMessageId: "user-1",
  })

  expect(parseAnalysisLinkMetadata(metadata)).toEqual({
    state: "completed",
    model: "flare",
    sourceMessageId: "user-1",
    error: undefined,
  })
})

test("completed analysis metadata does not create an analysis status", () => {
  const metadata = buildAnalysisMessageMetadata({
    state: "completed",
    model: "flare",
    sourceMessageId: "user-1",
  })

  expect(parseAnalysisMessageMetadata(metadata)).toBe(undefined)
})

test("analysis highlights metadata round-trips completed spans", () => {
  const metadata = buildAnalysisMessageMetadata({
    state: "completed",
    model: "spark",
    sourceMessageId: "user-1",
    highlights: [
      {
        charStart: 0,
        charEnd: 12,
        aiConfidence: 0.88,
        label: "AI",
      },
      {
        charStart: 12,
        charEnd: 20,
        aiConfidence: 0.14,
        label: "Human",
      },
    ],
  })

  expect(parseAnalysisHighlightsMetadata(metadata)).toEqual([
    {
      charStart: 0,
      charEnd: 12,
      aiConfidence: 0.88,
      label: "AI",
    },
    {
      charStart: 12,
      charEnd: 20,
      aiConfidence: 0.14,
      label: "Human",
    },
  ])
})
