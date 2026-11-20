import { AnalysisHighlightSpan, AnalysisLink, AnalysisMessageState, ModelType, PersistedAnalysisStatus } from "../types"

const ANALYSIS_STATE_KEY = "analysis_state"
const ANALYSIS_MODEL_KEY = "analysis_model"
const ANALYSIS_SOURCE_MESSAGE_ID_KEY = "analysis_source_message_id"
const ANALYSIS_ERROR_KEY = "analysis_error"
const ANALYSIS_HIGHLIGHTS_KEY = "analysis_highlights"

type AssistantAnalysisMetadataInput = {
  state: AnalysisMessageState | "completed"
  model: ModelType
  sourceMessageId: string
  error?: string
  highlights?: AnalysisHighlightSpan[]
}

const isModelType = (value: string): value is ModelType =>
  value === "spark" || value === "flare"

const isPersistedState = (value: string): value is AnalysisMessageState =>
  value === "running" || value === "cancelled" || value === "failed"

const isAnalysisLinkState = (value: string): value is AnalysisLink["state"] =>
  value === "completed" || isPersistedState(value)

export const buildAnalysisMessageMetadata = ({
  state,
  model,
  sourceMessageId,
  error,
  highlights,
}: AssistantAnalysisMetadataInput): Record<string, string> => {
  const metadata: Record<string, string> = {
    [ANALYSIS_STATE_KEY]: state,
    [ANALYSIS_MODEL_KEY]: model,
    [ANALYSIS_SOURCE_MESSAGE_ID_KEY]: sourceMessageId,
  }

  if (error) {
    metadata[ANALYSIS_ERROR_KEY] = error
  }

  if (highlights?.length) {
    metadata[ANALYSIS_HIGHLIGHTS_KEY] = JSON.stringify(highlights)
  }

  return metadata
}

const isHighlightLabel = (value: unknown): value is AnalysisHighlightSpan["label"] =>
  value === "AI" || value === "Human"

export const parseAnalysisHighlightsMetadata = (
  metadata?: Record<string, string>,
): AnalysisHighlightSpan[] | undefined => {
  const rawHighlights = metadata?.[ANALYSIS_HIGHLIGHTS_KEY]
  if (!rawHighlights) {
    return undefined
  }

  try {
    const parsed = JSON.parse(rawHighlights)
    if (!Array.isArray(parsed)) {
      return undefined
    }

    const highlights = parsed.flatMap((entry): AnalysisHighlightSpan[] => {
      if (typeof entry !== "object" || entry === null) {
        return []
      }

      const candidate = entry as Record<string, unknown>
      const charStart = candidate.charStart
      const charEnd = candidate.charEnd
      const aiConfidence = candidate.aiConfidence
      const label = typeof candidate.label === "string"
        ? candidate.label
        : undefined

      if (
        typeof charStart !== "number" ||
        typeof charEnd !== "number" ||
        typeof aiConfidence !== "number" ||
        charStart < 0 ||
        charEnd <= charStart ||
        aiConfidence < 0 ||
        aiConfidence > 1
      ) {
        return []
      }

      const normalizedLabel = isHighlightLabel(label)
        ? label
        : aiConfidence >= 0.5 ? "AI" : "Human"

      return [{
        charStart,
        charEnd,
        aiConfidence,
        label: normalizedLabel,
      }]
    })

    return highlights.length ? highlights : undefined
  } catch {
    return undefined
  }
}

export const parseAnalysisLinkMetadata = (
  metadata?: Record<string, string>,
): AnalysisLink | undefined => {
  if (!metadata) {
    return undefined
  }

  const state = metadata[ANALYSIS_STATE_KEY]
  const model = metadata[ANALYSIS_MODEL_KEY]
  const sourceMessageId = metadata[ANALYSIS_SOURCE_MESSAGE_ID_KEY]

  if (!state || !model || !sourceMessageId || !isAnalysisLinkState(state) || !isModelType(model)) {
    return undefined
  }

  return {
    state,
    model,
    sourceMessageId,
    error: metadata[ANALYSIS_ERROR_KEY],
  }
}

export const parseAnalysisMessageMetadata = (
  metadata?: Record<string, string>,
): PersistedAnalysisStatus | undefined => {
  const analysisLink = parseAnalysisLinkMetadata(metadata)

  if (!analysisLink || analysisLink.state === "completed") {
    return undefined
  }

  return {
    state: analysisLink.state,
    model: analysisLink.model,
    sourceMessageId: analysisLink.sourceMessageId,
    error: analysisLink.error,
  }
}
