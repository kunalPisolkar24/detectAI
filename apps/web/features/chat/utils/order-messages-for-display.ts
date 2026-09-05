import { Message } from "../types"

export const orderMessagesForDisplay = (messages: Message[]): Message[] => {
  const oldestFirstMessages = [...messages].reverse()
  const messageIds = new Set(oldestFirstMessages.map((message) => message.id))
  const linkedMessagesBySourceId = new Map<string, Message[]>()
  const movedAssistantIds = new Set<string>()

  for (const message of oldestFirstMessages) {
    const sourceMessageId =
      message.analysisLink?.sourceMessageId ??
      message.streamingProgress?.sourceMessageId ??
      message.analysisStatus?.sourceMessageId

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
