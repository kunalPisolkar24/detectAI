import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createChatAction,
  getChatAction,
  getChatHistoryAction,
  deleteChatAction,
  renameChatAction
} from '../../../actions/chat'
import { chatService } from '@/features/chat/services'

vi.mock('@/features/chat/services', () => ({
  chatService: {
    createChat: vi.fn(),
    getChat: vi.fn(),
    getHistory: vi.fn(),
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
