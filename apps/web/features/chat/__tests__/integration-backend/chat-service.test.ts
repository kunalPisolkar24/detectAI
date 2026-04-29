import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GrpcChatService } from '../../services/grpc-chat-service'
import { getChatGrpcClient } from '@/lib/shared/grpc/chat-client'
import { getServerSession } from 'next-auth'

vi.mock('@/lib/shared/grpc/chat-client', () => ({
  getChatGrpcClient: vi.fn(),
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

describe('GrpcChatService Integration', () => {
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

  it('creates a new chat via gRPC', async () => {
    mockClient.CreateChat.mockImplementation((_data: any, cb: any) => {
      cb(null, { chat_id: 'chat-123' })
    })

    const chat = await service.createChat('Hello world')

    expect(chat.id).toBe('chat-123')
    expect(mockClient.CreateChat).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', title: 'Hello world' }),
      expect.any(Function)
    )
  })

  it('saves a user message via gRPC', async () => {
    mockClient.SaveMessage.mockImplementation((_data: any, cb: any) => {
      cb(null, { message_id: 'msg-1', timestamp: Date.now() })
    })

    const msg = await service.saveUserMessage('chat-1', 'user-1', 'test content')

    expect(msg.id).toBe('msg-1')
    expect(mockClient.SaveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: 'chat-1',
        role: 'user',
        content: 'test content'
      }),
      expect.any(Function)
    )
  })

  it('handles gRPC errors gracefully', async () => {
    mockClient.CreateChat.mockImplementation((_data: any, cb: any) => {
      cb(new Error('gRPC Error'))
    })

    await expect(service.createChat('fail')).rejects.toThrow('gRPC Error')
  })
})
