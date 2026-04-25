import { describe, it, expect, vi, beforeEach } from 'vitest'
import { 
  createChatAction, 
  getChatAction, 
  getChatHistoryAction, 
  sendMessageAction, 
  deleteChatAction, 
  renameChatAction 
} from './chat'
import { chatService } from '@/features/chat/services'
import { getServerSession } from 'next-auth'
import { rateLimitService } from '@/features/rate-limit/services/rate-limit-service'
import { MAX_LIVE_ANALYSIS_CHARS } from '@/features/chat/constants'

vi.mock('@/features/chat/services', () => ({
  chatService: {
    createChat: vi.fn(),
    getChat: vi.fn(),
    getHistory: vi.fn(),
    sendMessage: vi.fn(),
    deleteChat: vi.fn(),
    renameChat: vi.fn(),
  },
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/config/auth-options', () => ({
  authOptions: {},
}))

vi.mock('@/features/rate-limit/services/rate-limit-service', () => ({
  rateLimitService: {
    checkLimit: vi.fn(),
    trackUsage: vi.fn(),
  },
}))

describe('Chat Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createChatAction', () => {
    it('successfully creates a chat', async () => {
      const mockChat = { id: 'chat-1' }
      vi.mocked(chatService.createChat).mockResolvedValue(mockChat as any)
      const result = await createChatAction('hello')
      expect(result).toEqual({ success: true, data: mockChat })
    })

    it('returns error on failure', async () => {
      vi.mocked(chatService.createChat).mockRejectedValue(new Error('Fail'))
      const result = await createChatAction('hello')
      expect(result).toEqual({ success: false, error: 'Fail' })
    })
  })

  describe('sendMessageAction', () => {
    const mockUser = { id: 'user-1', isPremium: false }
    const mockMessage = { id: 'msg-1' }

    it('returns error if unauthorized', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null)
      const result = await sendMessageAction('chat-1', 'content', 'model' as any)
      expect(result).toEqual({ success: false, error: 'Unauthorized' })
    })

    it('returns error if rate limit exceeded', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any)
      vi.mocked(rateLimitService.checkLimit).mockResolvedValue({ allowed: false } as any)
      const result = await sendMessageAction('chat-1', 'content', 'model' as any)
      expect(result).toEqual({ success: false, error: 'Rate limit exceeded', isRateLimit: true })
    })

    it('successfully sends a message', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any)
      vi.mocked(rateLimitService.checkLimit).mockResolvedValue({ allowed: true } as any)
      vi.mocked(chatService.sendMessage).mockResolvedValue(mockMessage as any)

      const result = await sendMessageAction('chat-1', 'content', 'model' as any)

      expect(chatService.sendMessage).toHaveBeenCalledWith('chat-1', 'content', 'model')
      expect(rateLimitService.trackUsage).toHaveBeenCalledWith(mockUser.id)
      expect(result).toEqual({ success: true, data: mockMessage })
    })

    it('handles rate limit error from service', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any)
      vi.mocked(rateLimitService.checkLimit).mockResolvedValue({ allowed: true } as any)
      vi.mocked(chatService.sendMessage).mockRejectedValue(new Error('Rate limit 429'))

      const result = await sendMessageAction('chat-1', 'content', 'model' as any)
      expect(result.success).toBe(false)
      expect(result.isRateLimit).toBe(true)
    })
  })

  describe('deleteChatAction', () => {
    it('successfully deletes a chat', async () => {
      vi.mocked(chatService.deleteChat).mockResolvedValue(undefined)
      const result = await deleteChatAction('chat-1')
      expect(result).toEqual({ success: true, data: undefined })
    })
  })

  describe('renameChatAction', () => {
    it('successfully renames a chat', async () => {
      const mockChat = { id: 'chat-1', title: 'New' }
      vi.mocked(chatService.renameChat).mockResolvedValue(mockChat as any)
      const result = await renameChatAction('chat-1', 'New')
      expect(result).toEqual({ success: true, data: mockChat })
    })
  })
})
