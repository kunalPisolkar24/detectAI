import { beforeEach, describe, expect, it } from "vitest"
import {
  getPreviewPremium,
  getPreviewUserId,
  setPreviewPremium,
} from "@/lib/config/preview"
import {
  getPreviewUsage,
  incrementPreviewUsage,
} from "@/features/preview/lib/preview-usage"
import {
  previewClearAll,
  previewCreateChat,
  previewDeleteChat,
  previewDeleteMessage,
  previewGetChat,
  previewGetHistory,
  previewPersistUserMessage,
  previewRenameChat,
  previewSaveAssistantMessage,
} from "@/features/preview/lib/preview-db"
import React from "react"

// NOTE: jsdom provides no indexedDB, so preview-db exercises its
// serverMemory branch here. The user-scoping logic is shared by both branches.

const USER_A = "preview-alice@example.com"
const USER_B = "preview-bob@example.com"

describe("getPreviewUserId", () => {
  it("returns preview session ids as-is", () => {
    expect(getPreviewUserId({ id: "preview-alice@example.com" })).toBe("preview-alice@example.com")
  })

  it("rejects missing, empty, and non-preview ids", () => {
    expect(getPreviewUserId(null)).toBeNull()
    expect(getPreviewUserId(undefined)).toBeNull()
    expect(getPreviewUserId({})).toBeNull()
    expect(getPreviewUserId({ id: "user-123" })).toBeNull()
    expect(getPreviewUserId({ id: "preview-" })).toBeNull()
  })
})

describe("preview chat isolation", () => {
  beforeEach(async () => {
    window.localStorage.clear()
    await previewClearAll()
  })

  it("keeps chat history separate per user", async () => {
    await previewCreateChat(USER_A, "Alice first analysis")
    await previewCreateChat(USER_B, "Bob first analysis")
    await previewCreateChat(USER_A, "Alice second analysis")

    const historyA = await previewGetHistory(USER_A)
    const historyB = await previewGetHistory(USER_B)

    expect(historyA).toHaveLength(2)
    expect(historyB).toHaveLength(1)
    expect(historyB[0].title).toContain("Bob first")
  })

  it("rejects cross-user chat reads, renames, and deletes", async () => {
    const chat = await previewCreateChat(USER_A, "Alice private analysis")

    await expect(previewGetChat(USER_B, chat.id)).rejects.toThrow("Chat not found")
    await expect(previewRenameChat(USER_B, chat.id, "Bob steals it")).rejects.toThrow("Chat not found")
    await expect(previewDeleteChat(USER_B, chat.id)).rejects.toThrow("Chat not found")

    // Owner is unaffected and can still manage the chat.
    expect((await previewGetChat(USER_A, chat.id)).title).toContain("Alice private")
    const renamed = await previewRenameChat(USER_A, chat.id, "Alice renamed")
    expect(renamed.title).toBe("Alice renamed")
    await previewDeleteChat(USER_A, chat.id)
    await expect(previewGetChat(USER_A, chat.id)).rejects.toThrow("Chat not found")
  })

  it("keeps messages and message deletes scoped per user", async () => {
    const chatA = await previewCreateChat(USER_A, "Alice analysis")
    const userMessage = await previewPersistUserMessage(
      USER_A,
      chatA.id,
      "msg-user-a",
      "some text to analyze ".repeat(30),
      new Date(),
    ).then(() => previewGetChat(USER_A, chatA.id)).then((c) => c.messages.find((m) => m.role === "user")!)

    // Another user cannot piggyback messages onto the chat or delete them.
    await expect(
      previewPersistUserMessage(USER_B, chatA.id, "msg-user-b", "intruder text", new Date()),
    ).rejects.toThrow("Chat not found")
    await previewDeleteMessage(USER_B, userMessage.id)
    expect((await previewGetChat(USER_A, chatA.id)).messages.map((m) => m.id)).toContain(userMessage.id)

    // Owner deletes work.
    await previewDeleteMessage(USER_A, userMessage.id)
    expect((await previewGetChat(USER_A, chatA.id)).messages.map((m) => m.id)).not.toContain(userMessage.id)
  })

  it("rejects assistant updates from another user", async () => {
    const chatA = await previewCreateChat(USER_A, "Alice analysis")
    const running = await previewSaveAssistantMessage(USER_A, chatA.id, {
      messageId: "msg-asst-a",
      state: "running",
      model: "spark",
      sourceMessageId: "msg-user-a",
    })

    await expect(
      previewSaveAssistantMessage(USER_B, chatA.id, {
        messageId: running.id,
        state: "failed",
        model: "spark",
        sourceMessageId: "msg-user-a",
        error: "hijack",
      }),
    ).rejects.toThrow()
  })
})

describe("preview premium isolation", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("scopes the premium flag per user", () => {
    setPreviewPremium(true, USER_A)

    expect(getPreviewPremium(USER_A)).toBe(true)
    expect(getPreviewPremium(USER_B)).toBe(false)

    setPreviewPremium(true, USER_B)
    setPreviewPremium(false, USER_A)

    expect(getPreviewPremium(USER_A)).toBe(false)
    expect(getPreviewPremium(USER_B)).toBe(true)
  })

  it("adopts a legacy global flag exactly once", () => {
    window.localStorage.setItem("preview:isPremium", "true")

    expect(getPreviewPremium(USER_A)).toBe(true)
    // The global flag is consumed so it can never leak to another user.
    expect(window.localStorage.getItem("preview:isPremium")).toBeNull()
    expect(getPreviewPremium(USER_B)).toBe(false)
  })
})

describe("preview usage isolation", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("tracks counters per user", () => {
    incrementPreviewUsage(USER_A)
    incrementPreviewUsage(USER_A)
    incrementPreviewUsage(USER_B)

    expect(getPreviewUsage(USER_A)).toMatchObject({ dailyCount: 2, totalCount: 2 })
    expect(getPreviewUsage(USER_B)).toMatchObject({ dailyCount: 1, totalCount: 1 })
  })
})
