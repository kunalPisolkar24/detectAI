import type { IChatService, AssistantAnalysisMessageInput } from "./chat-service.interface"
import type { AnalysisResult, ChatHistoryItem, ChatSession, Message, ModelType } from "../types"
import {
  previewCreateChat,
  previewGetChat,
  previewGetHistory,
  previewDeleteChat,
  previewRenameChat,
  previewSaveUserMessage,
  previewSaveAssistantMessage,
} from "@/features/preview/lib/preview-db"
import { generateMockAnalysis } from "@/features/preview/lib/mock-inference"

export class MockChatService implements IChatService {
  async createChat(initialMessage: string): Promise<ChatSession> {
    return previewCreateChat(initialMessage)
  }

  async getChat(chatId: string): Promise<ChatSession> {
    return previewGetChat(chatId)
  }

  async getHistory(): Promise<ChatHistoryItem[]> {
    return previewGetHistory()
  }

  async sendMessage(chatId: string, content: string, model: ModelType): Promise<Message> {
    const userMessage = await this.saveUserMessage(chatId, "preview-user", content)
    const analysis = generateMockAnalysis(content, model)
    return this.saveAssistantAnalysisMessage(chatId, "preview-user", {
      state: "completed",
      model,
      sourceMessageId: userMessage.id,
      analysis,
    })
  }

  async saveUserMessage(chatId: string, _userId: string, content: string, options?: { messageId?: string; createdAt?: Date }): Promise<Message> {
    return previewSaveUserMessage(chatId, content, options)
  }

  async saveAssistantAnalysis(_chatId: string, _userId: string, analysisResult: AnalysisResult): Promise<Message> {
    // Not used directly in preview flow; create a standalone assistant message
    const dummyChatId = crypto.randomUUID()
    return previewSaveAssistantMessage(dummyChatId, {
      state: "completed",
      model: analysisResult.model,
      sourceMessageId: crypto.randomUUID(),
      analysis: analysisResult,
    })
  }

  async saveAssistantAnalysisMessage(
    chatId: string,
    _userId: string,
    input: AssistantAnalysisMessageInput,
  ): Promise<Message> {
    return previewSaveAssistantMessage(chatId, {
      messageId: input.messageId,
      createdAt: input.createdAt,
      state: input.state,
      model: input.model,
      sourceMessageId: input.sourceMessageId,
      error: input.error,
      analysis: input.analysis,
    })
  }

  async deleteChat(chatId: string): Promise<void> {
    return previewDeleteChat(chatId)
  }

  async renameChat(chatId: string, newTitle: string): Promise<ChatHistoryItem> {
    return previewRenameChat(chatId, newTitle)
  }
}
