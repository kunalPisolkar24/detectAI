import { Message } from "../types"

const getSourceMessageId = (message: Message): string | undefined =>
  message.analysisLink?.sourceMessageId ??
  message.streamingProgress?.sourceMessageId ??
  message.analysisStatus?.sourceMessageId

const getCreatedAtMs = (message: Message): number => {
  const value = message.createdAt
  if (value instanceof Date) return value.getTime()
  return new Date(value).getTime()
}

/**
 * Order messages so each assistant analysis renders immediately after its
 * source user message.
 *
 * The baseline is a stable oldest-first sort by `createdAt` (input direction
 * agnostic), so the helper is idempotent: already-ordered input is returned
 * unchanged, whether it comes from the Dexie/gRPC fetch path or the
 * optimistic React Query cache. Assistants without a resolvable source keep
 * their baseline position instead of being reversed.
 */
export const orderMessagesForDisplay = (messages: Message[]): Message[] => {
  const oldestFirstMessages = messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const byTime = getCreatedAtMs(a.message) - getCreatedAtMs(b.message)
      if (byTime !== 0) return byTime
      return a.index - b.index
    })
    .map((entry) => entry.message)
  const messageIds = new Set(oldestFirstMessages.map((message) => message.id))
  const linkedMessagesBySourceId = new Map<string, Message[]>()
  const movedAssistantIds = new Set<string>()

  for (const message of oldestFirstMessages) {
    const sourceMessageId = getSourceMessageId(message)

    if (message.role !== "assistant" || !sourceMessageId || !messageIds.has(sourceMessageId)) {
      continue
    }

    const linkedMessages = linkedMessagesBySourceId.get(sourceMessageId)
    if (linkedMessages) {
      linkedMessages.push(message)
    } else {
      linkedMessagesBySourceId.set(sourceMessageId, [message])
    }

    movedAssistantIds.add(message.id)
  }

  const orderedMessages: Message[] = []

  for (const message of oldestFirstMessages) {
    if (movedAssistantIds.has(message.id)) {
      continue
    }

    orderedMessages.push(message)

    const linkedMessages = linkedMessagesBySourceId.get(message.id)
    if (linkedMessages) {
      orderedMessages.push(...linkedMessages)
    }
  }

  return orderedMessages
}
