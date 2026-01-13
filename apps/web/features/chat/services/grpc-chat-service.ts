import { IChatService } from "./chat-service.interface"
import { ChatSession, ChatHistoryItem, Message, ModelType } from "../types"
import { getChatGrpcClient } from "@/lib/grpc/chat-client"
import { inferenceService } from "./inference-service"
import { 
  mapGrpcMessageToDomain, 
  mapDomainAnalysisToGrpc, 
  mapGrpcSummaryToHistoryItem,
  mapGrpcChatToSession
} from "../utils/mappers"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"

export class GrpcChatService implements IChatService {
  private get client() {
    return getChatGrpcClient()
  }

  private async getUserId(): Promise<string> {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) throw new Error("Unauthorized")
    return session.user.id
  }

  async createChat(initialMessage: string): Promise<ChatSession> {
    const userId = await this.getUserId()
    const title = initialMessage.slice(0, 40) || "New Chat"

    return new Promise((resolve, reject) => {
      this.client.CreateChat({ user_id: userId, title }, (err: any, response: any) => {
        if (err) return reject(new Error(err.details || "Failed to create chat"))
        
        resolve({
          id: response.chat_id,
          title,
          messages: [],
          updatedAt: new Date()
        })
      })
    })
  }

  async getChat(chatId: string): Promise<ChatSession> {
    const [chatData, historyData] = await Promise.all([
      this.fetchChatMetadata(chatId),
      this.fetchChatHistory(chatId, 1, 100)
    ])

    return mapGrpcChatToSession(chatData, historyData)
  }

  async getHistory(): Promise<ChatHistoryItem[]> {
    const userId = await this.getUserId()

    return new Promise((resolve, reject) => {
      this.client.GetUserChats({ user_id: userId, limit: 50 }, (err: any, response: any) => {
        if (err) return reject(new Error(err.details || "Failed to fetch history"))
        
        const items = (response.chats || []).map(mapGrpcSummaryToHistoryItem)
        resolve(items)
      })
    })
  }

  async sendMessage(chatId: string, content: string, model: ModelType): Promise<Message> {
    const userId = await this.getUserId()

    await this.saveToBackend(chatId, userId, "user", content)

    const analysisResult = await inferenceService.detect(content, model)

    return this.saveToBackend(
      chatId, 
      userId, 
      "assistant", 
      "", 
      analysisResult
    )
  }

  async deleteChat(chatId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.DeleteChat({ chat_id: chatId }, (err: any) => {
        if (err) return reject(new Error(err.details || "Failed to delete chat"))
        resolve()
      })
    })
  }

  async renameChat(chatId: string, newTitle: string): Promise<ChatHistoryItem> {
    return new Promise((resolve, reject) => {
      this.client.RenameChat({ chat_id: chatId, new_title: newTitle }, (err: any) => {
        if (err) return reject(new Error(err.details || "Failed to rename chat"))
        
        resolve({
          id: chatId,
          title: newTitle,
          updatedAt: new Date()
        })
      })
    })
  }

  private async fetchChatMetadata(chatId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client.GetChat({ chat_id: chatId }, (err: any, response: any) => {
        if (err) return reject(new Error(err.details || "Chat not found"))
        resolve(response)
      })
    })
  }

  private async fetchChatHistory(chatId: string, page: number, pageSize: number): Promise<Message[]> {
    return new Promise((resolve, reject) => {
      this.client.GetChatHistory({
        chat_id: chatId,
        page,
        page_size: pageSize
      }, (err: any, response: any) => {
        if (err) {
          console.error("Failed to load history:", err)
          return resolve([]) 
        }
        
        const messages = (response.messages || []).map(mapGrpcMessageToDomain)
        resolve(messages.reverse())
      })
    })
  }

  private async saveToBackend(
    chatId: string, 
    userId: string, 
    role: "user" | "assistant", 
    content: string,
    analysisResult?: any
  ): Promise<Message> {
    
    const grpcAnalysis = analysisResult ? mapDomainAnalysisToGrpc(analysisResult) : undefined

    return new Promise((resolve, reject) => {
      this.client.SaveMessage({
        chat_id: chatId,
        user_id: userId,
        role,
        content,
        analysis: grpcAnalysis,
        metadata: {}
      }, (err: any, response: any) => {
        if (err) return reject(new Error(err.details || "Failed to save message"))

        const msg: Message = {
          id: response.message_id,
          role,
          content,
          createdAt: new Date(parseInt(response.timestamp) * 1000),
          analysis: analysisResult
        }
        resolve(msg)
      })
    })
  }
}