export type ModelType = "spark" | "flare"
export type AnalysisMessageState = "running" | "cancelled" | "failed"
export type AnalysisLinkState = AnalysisMessageState | "completed"

export interface AnalysisScore {
  ai: number
  human: number
}

export interface AnalysisHighlightSpan {
  charStart: number
  charEnd: number
  aiConfidence: number
  label: "AI" | "Human"
}

export interface AnalysisResult {
  model: ModelType
  label: "AI" | "Human"
  confidence: number
  scores: AnalysisScore
  highlights: AnalysisHighlightSpan[]
  raw: unknown
}

export interface StreamingAnalysisProgress {
  model: ModelType
  processedChunks: number
  totalChunks: number
  status: "running" | "cancelled" | "failed"
  retryContent?: string
  error?: string
  sourceMessageId?: string
}

export interface PersistedAnalysisStatus {
  state: AnalysisMessageState
  model: ModelType
  sourceMessageId: string
  error?: string
}

export interface AnalysisLink {
  state: AnalysisLinkState
  model: ModelType
  sourceMessageId: string
  error?: string
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  analysis?: AnalysisResult
  analysisStatus?: PersistedAnalysisStatus
  analysisLink?: AnalysisLink
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
