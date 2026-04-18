import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GrpcChatService } from './grpc-chat-service'
import { getChatGrpcClient } from '@/lib/grpc/chat-client'
import { inferenceService } from './inference-service'
import { getServerSession } from 'next-auth'

vi.mock('@/lib/grpc/chat-client')
vi.mock('./inference-service')
vi.mock('next-auth')
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }))

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
    }
    vi.mocked(getChatGrpcClient).mockReturnValue(mockClient)
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-1' } } as any)
    service = new GrpcChatService()
  })

  describe('createChat', () => {
    it('should call CreateChat and return a ChatSession', async () => {
      mockClient.CreateChat.mockImplementation((data: any, cb: any) => {
        cb(null, { chat_id: 'chat-1' })
      })

      const session = await service.createChat('Hello')

      expect(session.id).toBe('chat-1')
      expect(session.title).toBe('Hello')
      expect(mockClient.CreateChat).toHaveBeenCalledWith(
        { user_id: 'user-1', title: 'Hello' },
        expect.any(Function)
      )
    })

    it('should reject if CreateChat fails', async () => {
      mockClient.CreateChat.mockImplementation((data: any, cb: any) => {
        cb(new Error('GRPC Error'))
      })

      await expect(service.createChat('Hello')).rejects.toThrow('GRPC Error')
    })
  })

  describe('sendMessage', () => {
    it('should save user message and assistant analysis', async () => {
      const mockInference = { 
        label: 'AI', 
        confidence: 0.8, 
        scores: { ai: 0.8, human: 0.2 }, 
        model: 'spark', 
        highlights: [],
        raw: {}
      }
      vi.mocked(inferenceService.detect).mockResolvedValue(mockInference as any)
      
      // First call for saveUserMessage
      mockClient.SaveMessage.mockImplementationOnce((data: any, cb: any) => {
        cb(null, { message_id: 'msg-user', timestamp: 123456789 })
      })
      // Second call for saveAssistantAnalysisMessage
      mockClient.SaveMessage.mockImplementationOnce((data: any, cb: any) => {
        cb(null, { message_id: 'msg-assistant', timestamp: 123456790 })
      })

      const result = await service.sendMessage('chat-1', 'Hello', 'spark')

      expect(result.id).toBe('msg-assistant')
      expect(mockClient.SaveMessage).toHaveBeenCalledTimes(2)
      expect(inferenceService.detect).toHaveBeenCalledWith('Hello', 'spark')
    })
  })
})
