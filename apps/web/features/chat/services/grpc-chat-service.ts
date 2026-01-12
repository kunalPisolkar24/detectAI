import { IChatService } from "./chat-service.interface"
import { ChatSession, ChatHistoryItem, Message, ModelType } from "../types"
import { getChatGrpcClient } from "@/lib/grpc/chat-client"
import { inferenceService } from "./inference-service"
import { mapGrpcMessageToDomain, mapDomainAnalysisToGrpc } from "../utils/mappers"
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
        if (err) return reject(err)
        
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
    const history = await this.getChatHistoryMessages(chatId, 1, 50)
    
    return {
      id: chatId,
      title: "Chat Session",
      messages: history.reverse(),
      updatedAt: new Date()
    }
  }

  async getHistory(): Promise<ChatHistoryItem[]> {
    console.warn("GetHistory not implemented in Go Backend Proto")
    return []
  }

  async sendMessage(chatId: string, content: string, model: ModelType): Promise<Message> {
    const userId = await this.getUserId()

    const [_, analysisResult] = await Promise.all([
      this.saveToBackend(chatId, userId, "user", content),
      inferenceService.detect(content, model)
    ])

    const assistantMessage = await this.saveToBackend(
      chatId, 
      userId, 
      "assistant", 
      "", 
      analysisResult
    )

    return assistantMessage
  }

  async deleteChat(chatId: string): Promise<void> {
    console.warn("DeleteChat not implemented in Go Backend Proto")
  }

  async renameChat(chatId: string, newTitle: string): Promise<ChatHistoryItem> {
    console.warn("RenameChat not implemented in Go Backend Proto")
    return { id: chatId, title: newTitle, updatedAt: new Date() }
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
        if (err) return reject(err)

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

  private async getChatHistoryMessages(chatId: string, page: number, pageSize: number): Promise<Message[]> {
    return new Promise((resolve, reject) => {
      this.client.GetChatHistory({
        chat_id: chatId,
        page,
        page_size: pageSize
      }, (err: any, response: any) => {
        if (err) return reject(err)
        
        const messages = (response.messages || []).map(mapGrpcMessageToDomain)
        resolve(messages)
      })
    })
  }
}