"use server"

import { chatService } from "@/features/chat/services"
import { MAX_LIVE_ANALYSIS_CHARS } from "@/features/chat/constants"
import { ModelType, ChatSession, Message, ChatHistoryItem } from "@/features/chat/types"
import { authOptions } from "@/lib/config/auth-options"
import { getServerSession } from "next-auth"
import { getPreviewUserId } from "@/lib/config/preview"
import type { ChatServiceScope } from "@/features/chat/services/chat-service.interface"
import { rateLimitService } from "@/features/rate-limit/services/rate-limit-service"

type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; isRateLimit?: boolean }

const isPreviewServer = () =>
  process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"

/**
 * Resolve the preview storage scope from the session. Returns undefined
 * outside preview mode (the gRPC service ignores it; the session there is
 * authoritative). Inside preview, a missing session fails closed downstream.
 */
async function previewScope(): Promise<ChatServiceScope | undefined> {
  if (!isPreviewServer()) return undefined
  const session = await getServerSession(authOptions)
  const userId = getPreviewUserId(session?.user)
  return userId ? { userId } : undefined
}

export async function createChatAction(initialMessage: string): Promise<ActionResponse<ChatSession>> {
  try {
    const chat = await chatService.createChat(initialMessage, await previewScope())
    return { success: true, data: chat }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create chat"
    }
  }
}

export async function getChatAction(chatId: string): Promise<ActionResponse<ChatSession>> {
  try {
    const chat = await chatService.getChat(chatId, await previewScope())
    return { success: true, data: chat }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to retrieve chat"
    }
  }
}

export async function getChatHistoryAction(): Promise<ActionResponse<ChatHistoryItem[]>> {
  try {
    const history = await chatService.getHistory(await previewScope())
    return { success: true, data: history }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to retrieve history"
    }
  }
}

export async function sendMessageAction(chatId: string, content: string, model: ModelType): Promise<ActionResponse<Message>> {
  try {
    const isPreview = process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"
    if (!isPreview) {
      const session = await getServerSession(authOptions)
      if (!session?.user?.id) {
        return { success: false, error: "Unauthorized" }
      }

      const { allowed } = await rateLimitService.checkLimit(session.user.id, session.user.isPremium ?? false)

      if (!allowed) {
        return { success: false, error: "Rate limit exceeded", isRateLimit: true }
      }
    }

    if (content.length > MAX_LIVE_ANALYSIS_CHARS) {
      return {
        success: false,
        error: `Text exceeds maximum length of ${MAX_LIVE_ANALYSIS_CHARS} characters`
      }
    }

    const scope = await previewScope()
    const message = scope
      ? await chatService.sendMessage(chatId, content, model, scope)
      : await chatService.sendMessage(chatId, content, model)

    if (process.env.PREVIEW_MODE !== "true" && process.env.NEXT_PUBLIC_PREVIEW_MODE !== "true") {
      const session = await getServerSession(authOptions)
      if (session?.user?.id) await rateLimitService.trackUsage(session.user.id)
    }

    return { success: true, data: message }
  } catch (error) {
    const isRateLimit = error instanceof Error && (
      error.message.includes("Rate limit") ||
      error.message.includes("429")
    )

    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send message",
      isRateLimit
    }
  }
}

export async function deleteChatAction(chatId: string): Promise<ActionResponse<void>> {
  try {
    await chatService.deleteChat(chatId, await previewScope())
    return { success: true, data: undefined }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete chat"
    }
  }
}

export async function renameChatAction(chatId: string, newTitle: string): Promise<ActionResponse<ChatHistoryItem>> {
  try {
    const result = await chatService.renameChat(chatId, newTitle, await previewScope())
    return { success: true, data: result }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to rename chat"
    }
  }
}
