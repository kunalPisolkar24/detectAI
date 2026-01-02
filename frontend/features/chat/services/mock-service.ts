import { AnalysisResult, ChatSession, Message, ModelType } from "../types"

interface SparkRawResponse {
  confidence: number
  model: string
  predicted_label: number
}

interface FlareRawResponse {
  model: string
  predicted_label: number
  probability_ai: number
  probability_human: number
}

const DELAY_MS = 1500

class MockChatService {
  private chats: ChatSession[] = []

  private async delay() {
    return new Promise((resolve) => setTimeout(resolve, DELAY_MS))
  }

  private normalizeSparkResponse(raw: SparkRawResponse): AnalysisResult {
    const isAI = raw.predicted_label === 0
    const confidence = raw.confidence
    
    return {
      model: "spark",
      label: isAI ? "AI" : "Human",
      confidence: confidence,
      scores: {
        ai: isAI ? confidence : 1 - confidence,
        human: isAI ? 1 - confidence : confidence
      },
      raw
    }
  }

  private normalizeFlareResponse(raw: FlareRawResponse): AnalysisResult {
    const aiScore = raw.probability_ai
    const humanScore = raw.probability_human
    const isAI = aiScore > humanScore

    return {
      model: "flare",
      label: isAI ? "AI" : "Human",
      confidence: Math.max(aiScore, humanScore),
      scores: {
        ai: aiScore,
        human: humanScore
      },
      raw
    }
  }

  async createChat(initialMessage: string): Promise<ChatSession> {
    const newChat: ChatSession = {
      id: crypto.randomUUID(),
      title: initialMessage.slice(0, 40),
      messages: [],
      updatedAt: new Date()
    }
    this.chats.push(newChat)
    return newChat
  }

  async getChat(chatId: string): Promise<ChatSession> {
    await this.delay()
    const chat = this.chats.find((c) => c.id === chatId)

    if (!chat) {
      throw new Error("Chat session not found")
    }

    return chat
  }

  async sendMessage(chatId: string, content: string, model: ModelType): Promise<Message> {
    await this.delay()

    let analysis: AnalysisResult

    if (model === "spark") {
      const mockRaw: SparkRawResponse = {
        confidence: 0.85 + Math.random() * 0.14,
        model: "sequential",
        predicted_label: Math.random() > 0.5 ? 0 : 1
      }
      analysis = this.normalizeSparkResponse(mockRaw)
    } else {
      const probAI = Math.random()
      const mockRaw: FlareRawResponse = {
        model: "bert",
        predicted_label: probAI > 0.5 ? 0 : 1,
        probability_ai: probAI,
        probability_human: 1 - probAI
      }
      analysis = this.normalizeFlareResponse(mockRaw)
    }

    return {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "", 
      analysis,
      createdAt: new Date()
    }
  }
}

export const chatService = new MockChatService()