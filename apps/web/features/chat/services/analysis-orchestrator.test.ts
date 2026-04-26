import { describe, it, expect, vi, beforeEach } from "vitest"
import { AnalysisOrchestrator } from "./analysis-orchestrator"
import { InferenceStreamAbortedError } from "./inference-service"

const mockChatService = {
  saveUserMessage: vi.fn(),
  saveAssistantAnalysisMessage: vi.fn(),
}

const mockInferenceService = {
  streamDocument: vi.fn(),
}

const mockRateLimitService = {
  trackUsage: vi.fn(),
}

describe("AnalysisOrchestrator", () => {
  let orchestrator: AnalysisOrchestrator
  let abortController: AbortController

  beforeEach(() => {
    vi.clearAllMocks()
    abortController = new AbortController()
    orchestrator = new AnalysisOrchestrator(
      mockChatService as any,
      mockInferenceService as any,
      mockRateLimitService as any
    )
  })

  it("handles new analysis happy path", async () => {
    const params = {
      chatId: "chat-1",
      userId: "user-1",
      content: "some text",
      model: "spark" as const,
    }

    mockChatService.saveUserMessage.mockResolvedValue({ id: "msg-user" })
    mockChatService.saveAssistantAnalysisMessage.mockResolvedValue({
      id: "msg-asst",
      createdAt: new Date(),
    })

    mockInferenceService.streamDocument.mockImplementation(async (text, model, handlers) => {
      handlers.onEvent({ type: "started", totalChars: 100, totalChunks: 10 })
      handlers.onEvent({ type: "progress", processedChunks: 5, totalChunks: 10 })
      handlers.onEvent({ type: "final", result: { label: "AI" } as any })
    })

    const stream = await orchestrator.execute(params, abortController.signal)
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    
    let result = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      result += decoder.decode(value)
    }

    expect(mockChatService.saveUserMessage).toHaveBeenCalledWith("chat-1", "user-1", "some text")
    expect(mockChatService.saveAssistantAnalysisMessage).toHaveBeenCalledTimes(2)
    expect(mockRateLimitService.trackUsage).toHaveBeenCalledWith("user-1")
    expect(result).toContain('"type":"accepted"')
    expect(result).toContain('"type":"started"')
    expect(result).toContain('"type":"progress"')
    expect(result).toContain('"type":"final"')
  })

  it("handles retry analysis happy path", async () => {
    const params = {
      chatId: "chat-1",
      userId: "user-1",
      content: "some text",
      model: "spark" as const,
      assistantMessageId: "msg-asst-retry",
      assistantCreatedAt: new Date().toISOString(),
      sourceMessageId: "msg-user-source",
    }

    mockChatService.saveAssistantAnalysisMessage.mockResolvedValue({
      id: "msg-asst-retry",
      createdAt: new Date(),
    })

    mockInferenceService.streamDocument.mockImplementation(async (text, model, handlers) => {
      handlers.onEvent({ type: "final", result: { label: "AI" } as any })
    })

    await orchestrator.execute(params, abortController.signal)

    expect(mockChatService.saveUserMessage).not.toHaveBeenCalled()
    expect(mockChatService.saveAssistantAnalysisMessage).toHaveBeenCalledWith(
      "chat-1",
      "user-1",
      expect.objectContaining({ messageId: "msg-asst-retry" })
    )
  })

  it("handles inference errors", async () => {
    const params = {
      chatId: "chat-1",
      userId: "user-1",
      content: "some text",
      model: "spark" as const,
    }

    mockChatService.saveUserMessage.mockResolvedValue({ id: "msg-user" })
    mockChatService.saveAssistantAnalysisMessage.mockResolvedValue({
      id: "msg-asst",
      createdAt: new Date(),
    })

    mockInferenceService.streamDocument.mockRejectedValue(new Error("inference failed"))

    const stream = await orchestrator.execute(params, abortController.signal)
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    
    let result = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      result += decoder.decode(value)
    }

    expect(mockChatService.saveAssistantAnalysisMessage).toHaveBeenCalledWith(
      "chat-1",
      "user-1",
      expect.objectContaining({ state: "failed", error: "inference failed" })
    )
    expect(result).toContain('"type":"error"')
    expect(result).toContain('"error":"inference failed"')
  })

  it("handles client abort", async () => {
    const params = {
      chatId: "chat-1",
      userId: "user-1",
      content: "some text",
      model: "spark" as const,
    }

    mockChatService.saveUserMessage.mockResolvedValue({ id: "msg-user" })
    mockChatService.saveAssistantAnalysisMessage.mockResolvedValue({
      id: "msg-asst",
      createdAt: new Date(),
    })

    mockInferenceService.streamDocument.mockImplementation(async (text, model, handlers) => {
      abortController.abort()
      throw new InferenceStreamAbortedError()
    })

    const stream = await orchestrator.execute(params, abortController.signal)
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    expect(mockChatService.saveAssistantAnalysisMessage).toHaveBeenCalledWith(
      "chat-1",
      "user-1",
      expect.objectContaining({ state: "cancelled" })
    )
    expect(mockRateLimitService.trackUsage).not.toHaveBeenCalled()
  })

  it("handles missing final analysis result", async () => {
    const params = {
      chatId: "chat-1",
      userId: "user-1",
      content: "some text",
      model: "spark" as const,
    }

    mockChatService.saveUserMessage.mockResolvedValue({ id: "msg-user" })
    mockChatService.saveAssistantAnalysisMessage.mockResolvedValue({
      id: "msg-asst",
      createdAt: new Date(),
    })

    mockInferenceService.streamDocument.mockResolvedValue(undefined)

    const stream = await orchestrator.execute(params, abortController.signal)
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    
    let result = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      result += decoder.decode(value)
    }

    expect(mockChatService.saveAssistantAnalysisMessage).toHaveBeenCalledWith(
      "chat-1",
      "user-1",
      expect.objectContaining({ state: "failed", error: "Analysis did not produce a final result" })
    )
    expect(result).toContain('"error":"Analysis did not produce a final result"')
  })

  it("swallows rate limit tracking errors", async () => {
    const params = {
      chatId: "chat-1",
      userId: "user-1",
      content: "some text",
      model: "spark" as const,
    }

    mockChatService.saveUserMessage.mockResolvedValue({ id: "msg-user" })
    mockChatService.saveAssistantAnalysisMessage.mockResolvedValue({
      id: "msg-asst",
      createdAt: new Date(),
    })

    mockInferenceService.streamDocument.mockImplementation(async (text, model, handlers) => {
      handlers.onEvent({ type: "final", result: { label: "AI" } as any })
    })

    mockRateLimitService.trackUsage.mockRejectedValue(new Error("rate limit track failed"))

    const stream = await orchestrator.execute(params, abortController.signal)
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    expect(mockRateLimitService.trackUsage).toHaveBeenCalled()
    expect(mockChatService.saveAssistantAnalysisMessage).toHaveBeenCalledWith(
      "chat-1",
      "user-1",
      expect.objectContaining({ state: "completed" })
    )
  })
})
