import { Message, AnalysisResult, ChatHistoryItem, ChatSession } from "@/features/chat/types"

interface GrpcMessage {
  id: string
  chat_id: string
  user_id: string
  role: string
  content: string
  created_at: string | number
  metadata: Record<string, string>
  analysis?: GrpcAnalysis | null
}

interface GrpcAnalysis {
  human_score: number
  ai_score: number
  model_name: string
  verdict: string
}

interface GrpcChatSummary {
  id: string
  title: string
  updated_at: string | number
}

interface GrpcChatResponse {
  id: string
  title: string
  updated_at: string | number
  user_id: string
}

export const mapGrpcMessageToDomain = (grpcMsg: GrpcMessage): Message => {
  const createdAt = typeof grpcMsg.created_at === 'string' 
    ? parseInt(grpcMsg.created_at) * 1000 
    : (grpcMsg.created_at as number) * 1000

  const message: Message = {
    id: grpcMsg.id,
    role: grpcMsg.role as "user" | "assistant",
    content: grpcMsg.content,
    createdAt: new Date(createdAt), 
  }

  if (grpcMsg.analysis) {
    message.analysis = {
      model: grpcMsg.analysis.model_name === "spark" ? "spark" : "flare",
      label: grpcMsg.analysis.verdict === "AI" ? "AI" : "Human",
      confidence: Math.max(grpcMsg.analysis.human_score, grpcMsg.analysis.ai_score),
      scores: {
        human: grpcMsg.analysis.human_score,
        ai: grpcMsg.analysis.ai_score
      },
      raw: grpcMsg.analysis
    }
  }

  return message
}

export const mapDomainAnalysisToGrpc = (analysis: AnalysisResult): GrpcAnalysis => {
  return {
    human_score: analysis.scores.human,
    ai_score: analysis.scores.ai,
    model_name: analysis.model,
    verdict: analysis.label
  }
}

export const mapGrpcSummaryToHistoryItem = (summary: GrpcChatSummary): ChatHistoryItem => {
  const updatedAt = typeof summary.updated_at === 'string'
    ? parseInt(summary.updated_at) * 1000
    : (summary.updated_at as number) * 1000

  return {
    id: summary.id,
    title: summary.title,
    updatedAt: new Date(updatedAt)
  }
}

export const mapGrpcChatToSession = (chat: GrpcChatResponse, messages: Message[]): ChatSession => {
  const updatedAt = typeof chat.updated_at === 'string'
    ? parseInt(chat.updated_at) * 1000
    : (chat.updated_at as number) * 1000

  return {
    id: chat.id,
    title: chat.title,
    updatedAt: new Date(updatedAt),
    messages: messages
  }
}