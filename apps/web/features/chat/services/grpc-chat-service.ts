/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only"
import { IChatService } from "./chat-service.interface"
import { AnalysisResult, ChatSession, ChatHistoryItem, Message, ModelType } from "../types"
import { getChatGrpcClient } from "@/lib/grpc/chat-client"
import { inferenceService } from "./inference-service"
import { mapGrpcMessageToDomain, mapDomainAnalysisToGrpc } from "../utils/mappers"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"

interface GrpcChatSummary {
  id: string
  title: string
  updated_at: string
}

interface GrpcChatResponse {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

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
    const metaPromise = new Promise<GrpcChatResponse>((resolve, reject) => {
      this.client.GetChat({ chat_id: chatId }, (err: any, response: any) => {
        if (err) return reject(err)
        resolve(response)
      })
    })

    const historyPromise = new Promise<Message[]>((resolve, reject) => {
      this.client.GetChatHistory({
        chat_id: chatId,
        page: 1,
        page_size: 50
      }, (err: any, response: any) => {
        if (err) return reject(err)
        const messages = (response.messages || []).map(mapGrpcMessageToDomain)
        resolve(messages)
      })
    })

    const [meta, messages] = await Promise.all([metaPromise, historyPromise])

    return {
      id: meta.id,
      title: meta.title,
      messages: messages.reverse(),
      updatedAt: new Date(parseInt(meta.updated_at) * 1000)
    }
  }

  async getHistory(): Promise<ChatHistoryItem[]> {
    const userId = await this.getUserId()

    return new Promise((resolve, reject) => {
      this.client.GetUserChats({
        user_id: userId,
        limit: 50
      }, (err: any, response: any) => {
        if (err) return reject(err)

        const chats: ChatHistoryItem[] = (response.chats || []).map((c: GrpcChatSummary) => ({
          id: c.id,
          title: c.title,
          updatedAt: new Date(parseInt(c.updated_at) * 1000)
        }))

        resolve(chats)
      })
    })
  }

  async sendMessage(chatId: string, content: string, model: ModelType): Promise<Message> {
    const userId = await this.getUserId()

    const [, analysisResult] = await Promise.all([
      this.saveUserMessage(chatId, userId, content),
      inferenceService.detect(content, model)
    ])

    const assistantMessage = await this.saveAssistantAnalysis(chatId, userId, analysisResult)

    return assistantMessage
  }

  async saveUserMessage(chatId: string, userId: string, content: string): Promise<Message> {
    return this.saveToBackend(chatId, userId, "user", content)
  }

  async saveAssistantAnalysis(chatId: string, userId: string, analysisResult: AnalysisResult): Promise<Message> {
    return this.saveToBackend(chatId, userId, "assistant", "", analysisResult)
  }

  async deleteChat(chatId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.DeleteChat({ chat_id: chatId }, (err: any) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  async renameChat(chatId: string, newTitle: string): Promise<ChatHistoryItem> {
    return new Promise((resolve, reject) => {
      this.client.RenameChat({ chat_id: chatId, new_title: newTitle }, (err: any) => {
        if (err) return reject(err)
        resolve({
          id: chatId,
          title: newTitle,
          updatedAt: new Date()
        })
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
}
