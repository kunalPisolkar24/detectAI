import { Message, AnalysisResult } from "@/features/chat/types"
import {
  parseAnalysisHighlightsMetadata,
  parseAnalysisLinkMetadata,
  parseAnalysisMessageMetadata,
} from "./analysis-message-metadata"

interface GrpcMessage {
  id: string
  chat_id: string
  user_id: string
  role: string
  content: string
  created_at: string 
  metadata: Record<string, string>
  analysis?: GrpcAnalysis
}

interface GrpcAnalysis {
  human_score: number
  ai_score: number
  model_name: string
  verdict: string
}

export const mapGrpcMessageToDomain = (grpcMsg: GrpcMessage): Message => {
  const message: Message = {
    id: grpcMsg.id,
    role: grpcMsg.role as "user" | "assistant",
    content: grpcMsg.content,
    createdAt: new Date(parseInt(grpcMsg.created_at) * 1000), 
  }
  const highlights = parseAnalysisHighlightsMetadata(grpcMsg.metadata) ?? []

  if (grpcMsg.analysis) {
    message.analysis = {
      model: grpcMsg.analysis.model_name === "spark" ? "spark" : "flare",
      label: grpcMsg.analysis.verdict === "AI" ? "AI" : "Human",
      confidence: Math.max(grpcMsg.analysis.human_score, grpcMsg.analysis.ai_score),
      scores: {
        human: grpcMsg.analysis.human_score,
        ai: grpcMsg.analysis.ai_score
      },
      highlights,
      raw: grpcMsg.analysis
    }
  }

  const analysisLink = parseAnalysisLinkMetadata(grpcMsg.metadata)
  if (analysisLink) {
    message.analysisLink = analysisLink
  }

  const analysisStatus = parseAnalysisMessageMetadata(grpcMsg.metadata)
  if (analysisStatus) {
    message.analysisStatus = analysisStatus
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
