"use server"

import { chatService } from "@/features/chat/services"
import { ModelType } from "@/features/chat/types"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { rateLimitService } from "@/features/rate-limit/services/rate-limit-service"
import { revalidatePath } from "next/cache"

export async function getChatSession(chatId: string) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) throw new Error("Unauthorized")

    return await chatService.getChat(chatId)
  } catch (error) {
    console.error("Failed to load chat session:", error)
    throw new Error("Failed to load chat session")
  }
}

export async function getChatHistory() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return []

    return await chatService.getHistory()
  } catch (error) {
    console.error("Failed to load chat history:", error)
    return []
  }
}

export async function sendChatMessage(chatId: string | null, content: string, model: ModelType) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return { success: false as const, error: "Unauthorized" }
    }

    const { allowed } = await rateLimitService.checkLimit(
      session.user.id,
      session.user.isPremium ?? false
    )

    if (!allowed) {
      return { success: false as const, error: "Rate limit exceeded" }
    }

    await rateLimitService.trackUsage(session.user.id)

    if (!chatId) {
      const newChat = await chatService.createChat(content)
      const message = await chatService.sendMessage(newChat.id, content, model)
      
      revalidatePath("/chat")
      
      return { 
        success: true as const, 
        chat: newChat,
        message 
      }
    }

    const message = await chatService.sendMessage(chatId, content, model)
    return { success: true as const, message }

  } catch (error) {
    console.error("Chat Action Error:", error)
    return { 
      success: false as const, 
      error: error instanceof Error ? error.message : "Failed to process message" 
    }
  }
}

export async function deleteChatAction(chatId: string) {
  try {
    await chatService.deleteChat(chatId)
    revalidatePath("/chat")
    return { success: true }
  } catch (error) {
    console.error("Delete Action Error:", error)
    return { success: false, error: "Failed to delete chat" }
  }
}

export async function renameChatAction(chatId: string, title: string) {
  try {
    const updated = await chatService.renameChat(chatId, title)
    revalidatePath("/chat")
    return { success: true, data: updated }
  } catch (error) {
    console.error("Rename Action Error:", error)
    return { success: false, error: "Failed to rename chat" }
  }
}