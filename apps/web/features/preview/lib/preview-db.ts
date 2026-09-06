import Dexie, { Table } from "dexie"
import type { ChatHistoryItem, ChatSession, Message, AnalysisResult, ModelType } from "@/features/chat/types"
import { orderMessagesForDisplay } from "@/features/chat/utils/order-messages-for-display"
import { PREVIEW_LEGACY_USER_ID } from "@/lib/config/preview"

interface PreviewChatRow {
  id: string
  title: string
  updatedAt: number
  userId: string
}

interface PreviewMessageRow {
  id: string
  chatId: string
  userId: string
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
    // v2 scopes every row to a preview user. Pre-scoping rows are backfilled
    // as legacy and never match a real user query: archived, not migrated.
    this.version(2)
      .stores({
        chats: "id, updatedAt, userId",
        messages: "id, chatId, createdAt, userId, [chatId+userId]",
      })
      .upgrade(async (tx) => {
        await tx
          .table("chats")
          .toCollection()
          .modify((chat: PreviewChatRow) => {
            chat.userId = PREVIEW_LEGACY_USER_ID
          })
        await tx
          .table("messages")
          .toCollection()
          .modify((message: PreviewMessageRow) => {
            message.userId = PREVIEW_LEGACY_USER_ID
          })
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

async function getOwnedChat(userId: string, chatId: string): Promise<PreviewChatRow> {
  const row = isClient() ? await getDB()!.chats.get(chatId) : serverMemory.chats.get(chatId)
  if (!row || row.userId !== userId) throw new Error("Chat not found")
  return row
}

async function touchChat(userId: string, chatId: string, timestamp: number): Promise<void> {
  if (isClient()) {
    const db = getDB()!
    await db.chats.update(chatId, { updatedAt: timestamp })
  } else {
    const chat = serverMemory.chats.get(chatId)
    if (chat && chat.userId === userId) {
      serverMemory.chats.set(chatId, { ...chat, updatedAt: timestamp })
    }
  }
}

export async function previewCreateChat(userId: string, initialMessage: string): Promise<ChatSession> {
  const id = crypto.randomUUID()
  const title = initialMessage.slice(0, 40) || "New Chat"
  const now = Date.now()
  const row: PreviewChatRow = { id, title, updatedAt: now, userId }

  if (isClient()) {
    const db = getDB()!
    await db.chats.put(row)
  } else {
    serverMemory.chats.set(id, row)
  }

  return { id, title, messages: [], updatedAt: new Date(now) }
}

export async function previewGetChat(userId: string, chatId: string): Promise<ChatSession> {
  const chatRow = await getOwnedChat(userId, chatId)
  let messageRows: PreviewMessageRow[] = []

  if (isClient()) {
    const db = getDB()!
    messageRows = await db.messages.where("[chatId+userId]").equals([chatId, userId]).sortBy("createdAt")
  } else {
    messageRows = Array.from(serverMemory.messages.values())
      .filter((m) => m.chatId === chatId && m.userId === userId)
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

export async function previewGetHistory(userId: string): Promise<ChatHistoryItem[]> {
  let rows: PreviewChatRow[]
  if (isClient()) {
    const db = getDB()!
    rows = await db.chats.where("userId").equals(userId).sortBy("updatedAt")
    rows.reverse()
  } else {
    rows = Array.from(serverMemory.chats.values())
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }
  return rows.map(mapRowToHistory)
}

export async function previewDeleteChat(userId: string, chatId: string): Promise<void> {
  await getOwnedChat(userId, chatId)
  if (isClient()) {
    const db = getDB()!
    await db.transaction("rw", db.chats, db.messages, async () => {
      await db.chats.delete(chatId)
      await db.messages.where("[chatId+userId]").equals([chatId, userId]).delete()
    })
  } else {
    serverMemory.chats.delete(chatId)
    for (const [id, msg] of serverMemory.messages) {
      if (msg.chatId === chatId && msg.userId === userId) serverMemory.messages.delete(id)
    }
  }
}

export async function previewRenameChat(userId: string, chatId: string, newTitle: string): Promise<ChatHistoryItem> {
  const now = Date.now()
  if (isClient()) {
    const db = getDB()!
    await getOwnedChat(userId, chatId)
    await db.chats.update(chatId, { title: newTitle, updatedAt: now })
    const updated = await db.chats.get(chatId)
    return mapRowToHistory(updated!)
  } else {
    await getOwnedChat(userId, chatId)
    const existing = serverMemory.chats.get(chatId)!
    const updated = { ...existing, title: newTitle, updatedAt: now }
    serverMemory.chats.set(chatId, updated)
    return mapRowToHistory(updated)
  }
}

export async function previewSaveUserMessage(
  userId: string,
  chatId: string,
  content: string,
  options?: { messageId?: string; createdAt?: Date },
): Promise<Message> {
  await getOwnedChat(userId, chatId)
  const id = options?.messageId ?? crypto.randomUUID()
  const now = options?.createdAt ? options.createdAt.getTime() : Date.now()
  const row: PreviewMessageRow = {
    id,
    chatId,
    userId,
    role: "user",
    content,
    createdAt: now,
  }

  if (isClient()) {
    const db = getDB()!
    await db.messages.put(row)
  } else {
    serverMemory.messages.set(id, row)
  }
  await touchChat(userId, chatId, now)

  return mapRowToMessage(row)
}

export async function previewPersistUserMessage(
  userId: string,
  chatId: string,
  id: string,
  content: string,
  createdAt: Date,
): Promise<void> {
  await getOwnedChat(userId, chatId)
  const row: PreviewMessageRow = {
    id,
    chatId,
    userId,
    role: "user",
    content,
    createdAt: createdAt.getTime(),
  }
  const now = Date.now()
  if (isClient()) {
    const db = getDB()!
    await db.messages.put(row)
  } else {
    serverMemory.messages.set(id, row)
  }
  await touchChat(userId, chatId, now)
}

export async function previewPersistAssistantRunning(
  userId: string,
  chatId: string,
  id: string,
  createdAt: Date,
  model: ModelType,
  sourceMessageId: string,
): Promise<void> {
  await getOwnedChat(userId, chatId)
  const row: PreviewMessageRow = {
    id,
    chatId,
    userId,
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
  } else {
    serverMemory.messages.set(id, row)
  }
  await touchChat(userId, chatId, now)
}

export async function previewPersistAssistantFinal(
  userId: string,
  chatId: string,
  id: string,
  analysis: AnalysisResult,
  sourceMessageId: string,
): Promise<Message> {
  // Reuse previewSaveAssistantMessage for completion
  return previewSaveAssistantMessage(userId, chatId, {
    messageId: id,
    state: "completed",
    model: analysis.model,
    sourceMessageId,
    analysis,
  })
}

export async function previewPersistAssistantFailed(
  userId: string,
  chatId: string,
  id: string,
  model: ModelType,
  sourceMessageId: string,
  error: string,
  state: "failed" | "cancelled",
): Promise<void> {
  await previewSaveAssistantMessage(userId, chatId, {
    messageId: id,
    state,
    model,
    sourceMessageId,
    error: state === "failed" ? error : undefined,
  })
}

export async function previewSaveAssistantMessage(
  userId: string,
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
  await getOwnedChat(userId, chatId)
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
  if (existing && existing.userId !== userId) throw new Error("Message not found")
  if (existing && existing.chatId !== chatId) throw new Error("Message not found")
  const row: PreviewMessageRow = {
    id,
    chatId,
    userId,
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
  } else {
    serverMemory.messages.set(id, row)
  }
  await touchChat(userId, chatId, now)
  return mapRowToMessage(row)
}

export async function previewDeleteMessage(userId: string, messageId: string): Promise<void> {
  if (isClient()) {
    const db = getDB()!
    const existing = await db.messages.get(messageId)
    if (!existing || existing.userId !== userId) return
    await db.messages.delete(messageId)
  } else {
    const existing = serverMemory.messages.get(messageId)
    if (!existing || existing.userId !== userId) return
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
