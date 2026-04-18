import assert from "node:assert/strict"
import { test } from "node:test"

import { buildAnalysisMessageMetadata } from "./analysis-message-metadata"
import { mapGrpcMessageToDomain } from "./mappers"

test("hydrates persisted analysis highlights from assistant metadata", () => {
  const message = mapGrpcMessageToDomain({
    id: "assistant-1",
    chat_id: "chat-1",
    user_id: "user-1",
    role: "assistant",
    content: "",
    created_at: "1767225600",
    metadata: buildAnalysisMessageMetadata({
      state: "completed",
      model: "spark",
      sourceMessageId: "user-1",
      highlights: [
        {
          charStart: 0,
          charEnd: 8,
          aiConfidence: 0.72,
          label: "AI",
        },
      ],
    }),
    analysis: {
      human_score: 0.28,
      ai_score: 0.72,
      model_name: "spark",
      verdict: "AI",
    },
  })

  assert.equal(message.analysis?.highlights.length, 1)
  assert.deepEqual(message.analysis?.highlights[0], {
    charStart: 0,
    charEnd: 8,
    aiConfidence: 0.72,
    label: "AI",
  })
  assert.deepEqual(message.analysisLink, {
    state: "completed",
    model: "spark",
    sourceMessageId: "user-1",
    error: undefined,
  })
})
