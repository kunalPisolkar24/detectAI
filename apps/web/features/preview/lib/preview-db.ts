import Dexie, { Table } from "dexie"
import type { ChatHistoryItem, ChatSession, Message, AnalysisResult, ModelType } from "@/features/chat/types"
import { orderMessagesForDisplay } from "@/features/chat/utils/order-messages-for-display"

interface PreviewChatRow {
  id: string
  title: string
  updatedAt: number
}

interface PreviewMessageRow {
  id: string
  chatId: string
  role: "user" | "assistant"
  content: string
  createdAt: number
  analysis?: AnalysisResult
  analysisStatus?: Message["analysisStatus"]
  analysisLink?: Message["analysisLink"]
  isStreaming?: boolean
  streamingProgress?: Message["streamingProgress"]
}

class PreviewDB extends Dexie {
  chats!: Table<PreviewChatRow, string>
  messages!: Table<PreviewMessageRow, string>

  constructor() {
    super("preview-db")
    this.version(1).stores({
      chats: "id, updatedAt",
      messages: "id, chatId, createdAt",
    })
  }
}

let dbInstance: PreviewDB | null = null

function getDB(): PreviewDB | null {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return null
  if (!dbInstance) dbInstance = new PreviewDB()
  return dbInstance
}

// In-memory fallback for SSR / server actions (process-scoped)
const serverMemory = (() => {
  const chats = new Map<string, PreviewChatRow>()
  const messages = new Map<string, PreviewMessageRow>()
  return { chats, messages }
})()

function isClient(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined"
}

function mapRowToMessage(row: PreviewMessageRow): Message {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: new Date(row.createdAt),
    analysis: row.analysis,
    analysisStatus: row.analysisStatus,
    analysisLink: row.analysisLink,
    isStreaming: row.isStreaming,
    streamingProgress: row.streamingProgress,
  }
}

function mapRowToHistory(row: PreviewChatRow): ChatHistoryItem {
  return {
    id: row.id,
    title: row.title,
    updatedAt: new Date(row.updatedAt),
  }
}

export async function previewCreateChat(initialMessage: string): Promise<ChatSession> {
  const id = crypto.randomUUID()
  const title = initialMessage.slice(0, 40) || "New Chat"
  const now = Date.now()
  const row: PreviewChatRow = { id, title, updatedAt: now }

  if (isClient()) {
    const db = getDB()!
    await db.chats.put(row)
  } else {
    serverMemory.chats.set(id, row)
  }

  return { id, title, messages: [], updatedAt: new Date(now) }
}

export async function previewGetChat(chatId: string): Promise<ChatSession> {
  let chatRow: PreviewChatRow | undefined
  let messageRows: PreviewMessageRow[] = []

  if (isClient()) {
    const db = getDB()!
    chatRow = await db.chats.get(chatId)
    if (!chatRow) throw new Error("Chat not found")
    messageRows = await db.messages.where("chatId").equals(chatId).sortBy("createdAt")
  } else {
    chatRow = serverMemory.chats.get(chatId)
    if (!chatRow) throw new Error("Chat not found")
    messageRows = Array.from(serverMemory.messages.values())
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  const mapped = messageRows.map(mapRowToMessage)
  return {
    id: chatRow.id,
    title: chatRow.title,
    updatedAt: new Date(chatRow.updatedAt),
    messages: orderMessagesForDisplay(mapped),
  }
}

export async function previewGetHistory(): Promise<ChatHistoryItem[]> {
  let rows: PreviewChatRow[]
  if (isClient()) {
    const db = getDB()!
    rows = await db.chats.orderBy("updatedAt").reverse().toArray()
  } else {
    rows = Array.from(serverMemory.chats.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }
  return rows.map(mapRowToHistory)
}

export async function previewDeleteChat(chatId: string): Promise<void> {
  if (isClient()) {
    const db = getDB()!
    await db.transaction("rw", db.chats, db.messages, async () => {
      await db.chats.delete(chatId)
      await db.messages.where("chatId").equals(chatId).delete()
    })
  } else {
    serverMemory.chats.delete(chatId)
    for (const [id, msg] of serverMemory.messages) {
      if (msg.chatId === chatId) serverMemory.messages.delete(id)
    }
  }
}

export async function previewRenameChat(chatId: string, newTitle: string): Promise<ChatHistoryItem> {
  const now = Date.now()
  if (isClient()) {
    const db = getDB()!
    const existing = await db.chats.get(chatId)
    if (!existing) throw new Error("Chat not found")
    await db.chats.update(chatId, { title: newTitle, updatedAt: now })
    const updated = await db.chats.get(chatId)
    return mapRowToHistory(updated!)
  } else {
    const existing = serverMemory.chats.get(chatId)
    if (!existing) throw new Error("Chat not found")
    const updated = { ...existing, title: newTitle, updatedAt: now }
    serverMemory.chats.set(chatId, updated)
    return mapRowToHistory(updated)
  }
}

export async function previewSaveUserMessage(chatId: string, content: string): Promise<Message> {
  const id = crypto.randomUUID()
  const now = Date.now()
  const row: PreviewMessageRow = {
    id,
    chatId,
    role: "user",
    content,
    createdAt: now,
  }

  if (isClient()) {
    const db = getDB()!
    await db.messages.put(row)
    await db.chats.update(chatId, { updatedAt: now })
  } else {
    serverMemory.messages.set(id, row)
    const chat = serverMemory.chats.get(chatId)
    if (chat) serverMemory.chats.set(chatId, { ...chat, updatedAt: now })
  }

  return mapRowToMessage(row)
}

export async function previewPersistUserMessage(
  chatId: string,
  id: string,
  content: string,
  createdAt: Date,
): Promise<void> {
  const row: PreviewMessageRow = {
    id,
    chatId,
    role: "user",
    content,
    createdAt: createdAt.getTime(),
  }
  const now = Date.now()
  if (isClient()) {
    const db = getDB()!
    await db.messages.put(row)
    await db.chats.update(chatId, { updatedAt: now })
  } else {
    serverMemory.messages.set(id, row)
    const chat = serverMemory.chats.get(chatId)
    if (chat) serverMemory.chats.set(chatId, { ...chat, updatedAt: now })
  }
}

export async function previewPersistAssistantRunning(
  chatId: string,
  id: string,
  createdAt: Date,
  model: ModelType,
  sourceMessageId: string,
): Promise<void> {
  const row: PreviewMessageRow = {
    id,
    chatId,
    role: "assistant",
    content: "",
    createdAt: createdAt.getTime(),
    isStreaming: true,
    analysisStatus: { state: "running", model, sourceMessageId },
  }
  const now = Date.now()
  if (isClient()) {
    const db = getDB()!
    await db.messages.put(row)
    await db.chats.update(chatId, { updatedAt: now })
  } else {
    serverMemory.messages.set(id, row)
    const chat = serverMemory.chats.get(chatId)
    if (chat) serverMemory.chats.set(chatId, { ...chat, updatedAt: now })
  }
}

export async function previewPersistAssistantFinal(
  chatId: string,
  id: string,
  analysis: AnalysisResult,
  sourceMessageId: string,
): Promise<Message> {
  // Reuse previewSaveAssistantMessage for completion
  return previewSaveAssistantMessage(chatId, {
    messageId: id,
    state: "completed",
    model: analysis.model,
    sourceMessageId,
    analysis,
  })
}

export async function previewPersistAssistantFailed(
  chatId: string,
  id: string,
  model: ModelType,
  sourceMessageId: string,
  error: string,
  state: "failed" | "cancelled",
): Promise<void> {
  await previewSaveAssistantMessage(chatId, {
    messageId: id,
    state,
    model,
    sourceMessageId,
    error: state === "failed" ? error : undefined,
  })
}

export async function previewSaveAssistantMessage(
  chatId: string,
  input: {
    messageId?: string
    createdAt?: Date
    state: "running" | "cancelled" | "failed" | "completed"
    model: ModelType
    sourceMessageId: string
    error?: string
    analysis?: AnalysisResult
  },
): Promise<Message> {
  const isUpdate = !!input.messageId
  const id = input.messageId ?? crypto.randomUUID()
  const createdAtMs = input.createdAt ? input.createdAt.getTime() : Date.now()
  const now = Date.now()
  const shouldStoreAnalysis = input.state === "completed" && input.analysis
  let existing: PreviewMessageRow | undefined
  if (isClient()) {
    const db = getDB()!
    if (isUpdate) existing = await db.messages.get(id)
  } else {
    existing = serverMemory.messages.get(id)
  }
  const row: PreviewMessageRow = {
    id,
    chatId,
    role: "assistant",
    content: shouldStoreAnalysis ? "" : existing?.content ?? "",
    createdAt: existing ? existing.createdAt : createdAtMs,
    analysis: shouldStoreAnalysis ? input.analysis : existing?.analysis,
    analysisStatus:
      input.state === "completed"
        ? undefined
        : {
            state: input.state,
            model: input.model,
            sourceMessageId: input.sourceMessageId,
            ...(input.error ? { error: input.error } : {}),
          },
    analysisLink:
      input.state === "completed" && input.analysis
        ? {
            state: "completed",
            model: input.model,
            sourceMessageId: input.sourceMessageId,
          }
        : existing?.analysisLink,
    isStreaming: input.state === "running",
    streamingProgress: undefined,
  }
  if (input.state === "failed" || input.state === "cancelled") {
    row.analysis = undefined
    row.content = ""
  }
  if (input.state === "completed" && input.analysis) {
    row.isStreaming = false
  }
  if (isClient()) {
    const db = getDB()!
    await db.messages.put(row)
    await db.chats.update(chatId, { updatedAt: now })
  } else {
    serverMemory.messages.set(id, row)
    const chat = serverMemory.chats.get(chatId)
    if (chat) serverMemory.chats.set(chatId, { ...chat, updatedAt: now })
  }
  return mapRowToMessage(row)
}

export async function previewDeleteMessage(messageId: string): Promise<void> {
  if (isClient()) {
    const db = getDB()!
    await db.messages.delete(messageId)
  } else {
    serverMemory.messages.delete(messageId)
  }
}

export async function previewClearAll(): Promise<void> {
  if (isClient()) {
    const db = getDB()!
    await db.chats.clear()
    await db.messages.clear()
  } else {
    serverMemory.chats.clear()
    serverMemory.messages.clear()
  }
}
