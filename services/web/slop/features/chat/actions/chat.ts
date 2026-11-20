"use server"

import { chatService } from "@/features/chat/services"
import { ChatSession, ChatHistoryItem } from "@/features/chat/types"
import { authOptions } from "@/lib/config/auth-options"
import { getServerSession } from "next-auth"
import { getPreviewUserId, isPreviewMode } from "@/lib/config/preview"
import type { ChatServiceScope } from "@/features/chat/services/chat-service.interface"

type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; isRateLimit?: boolean }

/**
 * Resolve the preview storage scope from the session. Returns undefined
 * outside preview mode (the gRPC service ignores it; the session there is
 * authoritative). Inside preview, a missing session fails closed downstream.
 */
async function previewScope(): Promise<ChatServiceScope | undefined> {
  if (!isPreviewMode()) return undefined
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
