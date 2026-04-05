export type ModelType = "spark" | "flare"

export interface AnalysisScore {
  ai: number
  human: number
}

export interface AnalysisResult {
  model: ModelType
  label: "AI" | "Human"
  confidence: number
  scores: AnalysisScore
  raw: unknown
}

export interface StreamingAnalysisProgress {
  model: ModelType
  processedChunks: number
  totalChunks: number
  status: "running" | "cancelled" | "failed"
  retryContent?: string
  error?: string
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  analysis?: AnalysisResult
  createdAt: Date
  isStreaming?: boolean
  streamingProgress?: StreamingAnalysisProgress
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  updatedAt: Date
}

export interface ChatHistoryItem {
  id: string
  title: string
  updatedAt: Date
}
