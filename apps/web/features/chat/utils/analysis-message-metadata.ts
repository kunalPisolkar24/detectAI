import { AnalysisLink, AnalysisMessageState, ModelType, PersistedAnalysisStatus } from "../types"

const ANALYSIS_STATE_KEY = "analysis_state"
const ANALYSIS_MODEL_KEY = "analysis_model"
const ANALYSIS_SOURCE_MESSAGE_ID_KEY = "analysis_source_message_id"
const ANALYSIS_ERROR_KEY = "analysis_error"

type AssistantAnalysisMetadataInput = {
  state: AnalysisMessageState | "completed"
  model: ModelType
  sourceMessageId: string
  error?: string
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
}: AssistantAnalysisMetadataInput): Record<string, string> => {
  const metadata: Record<string, string> = {
    [ANALYSIS_STATE_KEY]: state,
    [ANALYSIS_MODEL_KEY]: model,
    [ANALYSIS_SOURCE_MESSAGE_ID_KEY]: sourceMessageId,
  }

  if (error) {
    metadata[ANALYSIS_ERROR_KEY] = error
  }

  return metadata
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
