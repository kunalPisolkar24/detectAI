import type { IChatService, AssistantAnalysisMessageInput, ChatServiceScope } from "@/lib/domain/chat-service"
import type { AnalysisResult, ChatHistoryItem, ChatSession, Message, ModelType } from "@/lib/domain/chat"
import {
  previewCreateChat,
  previewGetChat,
  previewGetHistory,
  previewDeleteChat,
  previewRenameChat,
  previewSaveUserMessage,
  previewSaveAssistantMessage,
} from "@/features/preview/lib/preview-db"
import { PREVIEW_LEGACY_USER_ID } from "@/lib/config/preview"
import { generateMockAnalysis } from "@/features/preview/lib/mock-inference"

/**
 * Scope resolution for preview storage. A missing scope fails closed to the
 * legacy bucket, whose rows are never returned to any user.
 */
const scopeUserId = (scope?: ChatServiceScope): string => scope?.userId ?? PREVIEW_LEGACY_USER_ID

export class MockChatService implements IChatService {
  async createChat(initialMessage: string, scope?: ChatServiceScope): Promise<ChatSession> {
    return previewCreateChat(scopeUserId(scope), initialMessage)
  }

  async getChat(chatId: string, scope?: ChatServiceScope): Promise<ChatSession> {
    return previewGetChat(scopeUserId(scope), chatId)
  }

  async getHistory(scope?: ChatServiceScope): Promise<ChatHistoryItem[]> {
    return previewGetHistory(scopeUserId(scope))
  }

  async sendMessage(chatId: string, content: string, model: ModelType, scope?: ChatServiceScope): Promise<Message> {
    const ownerId = scopeUserId(scope)
    const userMessage = await this.saveUserMessage(chatId, ownerId, content)
    const analysis = generateMockAnalysis(content, model)
    return this.saveAssistantAnalysisMessage(chatId, ownerId, {
      state: "completed",
      model,
      sourceMessageId: userMessage.id,
      analysis,
    })
  }

  async saveUserMessage(chatId: string, _userId: string, content: string, options?: { messageId?: string; createdAt?: Date }): Promise<Message> {
    return previewSaveUserMessage(_userId, chatId, content, options)
  }

  async saveAssistantAnalysis(_chatId: string, _userId: string, analysisResult: AnalysisResult): Promise<Message> {
    // Not used directly in preview flow; create a standalone assistant message
    const dummyChatId = crypto.randomUUID()
    return previewSaveAssistantMessage(_userId, dummyChatId, {
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
    return previewSaveAssistantMessage(_userId, chatId, {
      messageId: input.messageId,
      createdAt: input.createdAt,
      state: input.state,
      model: input.model,
      sourceMessageId: input.sourceMessageId,
      error: input.error,
      analysis: input.analysis,
    })
  }

  async deleteChat(chatId: string, scope?: ChatServiceScope): Promise<void> {
    return previewDeleteChat(scopeUserId(scope), chatId)
  }

  async renameChat(chatId: string, newTitle: string, scope?: ChatServiceScope): Promise<ChatHistoryItem> {
    return previewRenameChat(scopeUserId(scope), chatId, newTitle)
  }
}
