import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GrpcChatService } from './grpc-chat-service'
import { getChatGrpcClient } from '@/lib/shared/grpc/chat-client'
import { inferenceService } from './inference-service'
import { getServerSession } from 'next-auth'

vi.mock('@/lib/shared/grpc/chat-client')
vi.mock('./inference-service')
vi.mock('next-auth')
vi.mock('@/lib/config/auth-options', () => ({ authOptions: {} }))

// ── Shared fixtures ────────────────────────────────────────────────────────────
const MOCK_USER_ID = 'user-1'
const MOCK_CHAT_ID = 'chat-1'
const MOCK_INFERENCE_RESULT = {
  label: 'AI' as const,
  confidence: 0.8,
  scores: { ai: 0.8, human: 0.2 },
  model: 'spark' as const,
  highlights: [{ charStart: 0, charEnd: 5, aiConfidence: 0.8, label: 'AI' as const }],
  raw: {},
}

describe('GrpcChatService', () => {
  let service: GrpcChatService
  let mockClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = {
      CreateChat: vi.fn(),
      GetChat: vi.fn(),
      GetChatHistory: vi.fn(),
      GetUserChats: vi.fn(),
      SaveMessage: vi.fn(),
      DeleteChat: vi.fn(),
      RenameChat: vi.fn(),
    }
    vi.mocked(getChatGrpcClient).mockReturnValue(mockClient)
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: MOCK_USER_ID } } as any)
    service = new GrpcChatService()
  })

  // ─── createChat ───────────────────────────────────────────────────────────────
  describe('createChat', () => {
    it('returns a ChatSession with the gRPC chat_id', async () => {
      mockClient.CreateChat.mockImplementation((data: any, cb: any) => {
        cb(null, { chat_id: MOCK_CHAT_ID })
      })

      const session = await service.createChat('Hello world')

      expect(session.id).toBe(MOCK_CHAT_ID)
      expect(session.title).toBe('Hello world')
      expect(session.messages).toEqual([])
      expect(mockClient.CreateChat).toHaveBeenCalledWith(
        { user_id: MOCK_USER_ID, title: 'Hello world' },
        expect.any(Function),
      )
    })

    it('truncates the initial message to 40 chars for the title', async () => {
      mockClient.CreateChat.mockImplementation((data: any, cb: any) => {
        cb(null, { chat_id: MOCK_CHAT_ID })
      })
      const longMessage = 'A'.repeat(100)

      const session = await service.createChat(longMessage)

      expect(session.title.length).toBe(40)
    })

    it('falls back to "New Chat" title when initial message is empty', async () => {
      mockClient.CreateChat.mockImplementation((data: any, cb: any) => {
        cb(null, { chat_id: MOCK_CHAT_ID })
      })

      const session = await service.createChat('')

      expect(session.title).toBe('New Chat')
    })

    it('rejects when the gRPC call fails', async () => {
      mockClient.CreateChat.mockImplementation((data: any, cb: any) => {
        cb(new Error('gRPC unavailable'))
      })

      await expect(service.createChat('Hello')).rejects.toThrow('gRPC unavailable')
    })

    it('throws Unauthorized when no session exists', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null)

      await expect(service.createChat('Hello')).rejects.toThrow('Unauthorized')
    })
  })

  // ─── getChat ──────────────────────────────────────────────────────────────────
  describe('getChat', () => {
    it('fetches metadata and history in parallel and returns ordered messages', async () => {
      mockClient.GetChat.mockImplementation((data: any, cb: any) => {
        cb(null, { id: MOCK_CHAT_ID, user_id: MOCK_USER_ID, title: 'My Chat', created_at: '1700000000', updated_at: '1700000001' })
      })
      mockClient.GetChatHistory.mockImplementation((data: any, cb: any) => {
        cb(null, {
          messages: [
            { id: 'msg-user', chat_id: MOCK_CHAT_ID, user_id: MOCK_USER_ID, role: 'user', content: 'Hello', created_at: '1700000000', metadata: {} },
            { id: 'msg-asst', chat_id: MOCK_CHAT_ID, user_id: MOCK_USER_ID, role: 'assistant', content: '', created_at: '1700000001', metadata: {} },
          ],
        })
      })

      const chat = await service.getChat(MOCK_CHAT_ID)

      expect(chat.id).toBe(MOCK_CHAT_ID)
      expect(chat.title).toBe('My Chat')
      expect(chat.messages).toHaveLength(2)
      // Both GetChat and GetChatHistory must be called concurrently
      expect(mockClient.GetChat).toHaveBeenCalledWith({ chat_id: MOCK_CHAT_ID }, expect.any(Function))
      expect(mockClient.GetChatHistory).toHaveBeenCalledWith(
        { chat_id: MOCK_CHAT_ID, page: 1, page_size: 50 },
        expect.any(Function),
      )
    })

    it('rejects when GetChat fails', async () => {
      mockClient.GetChat.mockImplementation((data: any, cb: any) => {
        cb(new Error('Not found'))
      })
      mockClient.GetChatHistory.mockImplementation((data: any, cb: any) => {
        cb(null, { messages: [] })
      })

      await expect(service.getChat(MOCK_CHAT_ID)).rejects.toThrow('Not found')
    })
  })

  // ─── getHistory ───────────────────────────────────────────────────────────────
  describe('getHistory', () => {
    it('returns a list of ChatHistoryItems mapped from gRPC chats', async () => {
      mockClient.GetUserChats.mockImplementation((data: any, cb: any) => {
        cb(null, {
          chats: [
            { id: 'chat-1', title: 'First Chat', updated_at: '1700000001' },
            { id: 'chat-2', title: 'Second Chat', updated_at: '1700000002' },
          ],
        })
      })

      const history = await service.getHistory()

      expect(history).toHaveLength(2)
      expect(history[0].id).toBe('chat-1')
      expect(history[0].title).toBe('First Chat')
      expect(history[0].updatedAt).toBeInstanceOf(Date)
      expect(mockClient.GetUserChats).toHaveBeenCalledWith(
        { user_id: MOCK_USER_ID, limit: 50 },
        expect.any(Function),
      )
    })

    it('returns an empty array when the user has no chats', async () => {
      mockClient.GetUserChats.mockImplementation((data: any, cb: any) => {
        cb(null, { chats: [] })
      })

      const history = await service.getHistory()

      expect(history).toEqual([])
    })
  })

  // ─── sendMessage ──────────────────────────────────────────────────────────────
  describe('sendMessage', () => {
    it('saves user message and persists the assistant analysis result', async () => {
      vi.mocked(inferenceService.detect).mockResolvedValue(MOCK_INFERENCE_RESULT)
      mockClient.SaveMessage
        .mockImplementationOnce((data: any, cb: any) => cb(null, { message_id: 'msg-user', timestamp: 1700000000 }))
        .mockImplementationOnce((data: any, cb: any) => cb(null, { message_id: 'msg-asst', timestamp: 1700000001 }))

      const result = await service.sendMessage(MOCK_CHAT_ID, 'Analyze me', 'spark')

      expect(inferenceService.detect).toHaveBeenCalledWith('Analyze me', 'spark')
      expect(mockClient.SaveMessage).toHaveBeenCalledTimes(2)
      expect(result.id).toBe('msg-asst')
      expect(result.role).toBe('assistant')
    })

    it('carries highlight spans in the assistant message metadata', async () => {
      vi.mocked(inferenceService.detect).mockResolvedValue(MOCK_INFERENCE_RESULT)
      let capturedAssistantPayload: any
      mockClient.SaveMessage
        .mockImplementationOnce((data: any, cb: any) => cb(null, { message_id: 'msg-user', timestamp: 1700000000 }))
        .mockImplementationOnce((data: any, cb: any) => {
          capturedAssistantPayload = data
          cb(null, { message_id: 'msg-asst', timestamp: 1700000001 })
        })

      await service.sendMessage(MOCK_CHAT_ID, 'Analyze me', 'spark')

      // The second SaveMessage call (assistant) must include analysis data
      expect(capturedAssistantPayload.analysis).toBeDefined()
      expect(capturedAssistantPayload.analysis.ai_score).toBeCloseTo(0.8)
    })

    it('rejects when inference service is unavailable and does not save an assistant message', async () => {
      // saveUserMessage and inferenceService.detect run concurrently via Promise.all.
      // The user message is therefore saved before inference fails — this is correct
      // behaviour (we have the user input on record). What must NOT happen is saving
      // a broken/empty assistant analysis message.
      vi.mocked(inferenceService.detect).mockRejectedValue(new Error('AI Analysis Service Unavailable'))
      mockClient.SaveMessage.mockImplementation((data: any, cb: any) =>
        cb(null, { message_id: 'msg-user', timestamp: 1700000000 }),
      )

      await expect(service.sendMessage(MOCK_CHAT_ID, 'Hello', 'spark')).rejects.toThrow(
        'AI Analysis Service Unavailable',
      )
      // Only the user-side SaveMessage is called; the assistant message is never persisted
      expect(mockClient.SaveMessage).toHaveBeenCalledTimes(1)
      expect(mockClient.SaveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'user', content: 'Hello' }),
        expect.any(Function),
      )
    })
  })

  // ─── deleteChat ───────────────────────────────────────────────────────────────
  describe('deleteChat', () => {
    it('calls DeleteChat with the correct chat_id', async () => {
      mockClient.DeleteChat.mockImplementation((data: any, cb: any) => cb(null))

      await service.deleteChat(MOCK_CHAT_ID)

      expect(mockClient.DeleteChat).toHaveBeenCalledWith({ chat_id: MOCK_CHAT_ID }, expect.any(Function))
    })

    it('rejects when DeleteChat fails', async () => {
      mockClient.DeleteChat.mockImplementation((data: any, cb: any) => cb(new Error('Permission denied')))

      await expect(service.deleteChat(MOCK_CHAT_ID)).rejects.toThrow('Permission denied')
    })
  })

  // ─── renameChat ───────────────────────────────────────────────────────────────
  describe('renameChat', () => {
    it('returns an updated ChatHistoryItem with the new title', async () => {
      mockClient.RenameChat.mockImplementation((data: any, cb: any) => cb(null))

      const result = await service.renameChat(MOCK_CHAT_ID, 'New Title')

      expect(result.id).toBe(MOCK_CHAT_ID)
      expect(result.title).toBe('New Title')
      expect(result.updatedAt).toBeInstanceOf(Date)
      expect(mockClient.RenameChat).toHaveBeenCalledWith(
        { chat_id: MOCK_CHAT_ID, new_title: 'New Title' },
        expect.any(Function),
      )
    })

    it('rejects when RenameChat fails', async () => {
      mockClient.RenameChat.mockImplementation((data: any, cb: any) => cb(new Error('Chat not found')))

      await expect(service.renameChat(MOCK_CHAT_ID, 'New Title')).rejects.toThrow('Chat not found')
    })
  })
})
