import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/test-utils'
import { MobileHeader } from './mobile-header'
import { useChatUIStore } from '../../stores/ui-store'
import { useChatHistory, useChatSession } from '../../hooks/use-chat-history'
import { useChatMutations } from '../../hooks/use-chat-mutation'

vi.mock('../../stores/ui-store', () => ({
  useChatUIStore: vi.fn(),
}))

vi.mock('../../hooks/use-chat-history', () => ({
  useChatHistory: vi.fn(),
  useChatSession: vi.fn(),
}))

vi.mock('../../hooks/use-chat-mutation', () => ({
  useChatMutations: vi.fn(),
}))

describe('MobileHeader', () => {
  const mockSetCurrentChatId = vi.fn()
  const mockDeleteChat = { mutate: vi.fn() }
  const mockRenameChat = { mutate: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useChatUIStore).mockReturnValue({
      currentChatId: 'chat-1',
      setCurrentChatId: mockSetCurrentChatId,
    } as any)
    vi.mocked(useChatHistory).mockReturnValue({
      data: [{ id: 'chat-1', title: 'Chat 1' }],
      isLoading: false,
    } as any)
    vi.mocked(useChatSession).mockReturnValue({
      data: { id: 'chat-1', title: 'Chat 1' },
      isLoading: false,
    } as any)
    vi.mocked(useChatMutations).mockReturnValue({
      deleteChat: mockDeleteChat,
      renameChat: mockRenameChat,
    } as any)
  })

  it('renders chat title on mobile', () => {
    render(<MobileHeader />)
    expect(screen.getByText('Chat 1')).toBeInTheDocument()
  })

  it('renders logo when no chat is selected', () => {
    vi.mocked(useChatUIStore).mockReturnValue({
      currentChatId: null,
      setCurrentChatId: mockSetCurrentChatId,
    } as any)
    vi.mocked(useChatSession).mockReturnValue({ data: null, isLoading: false } as any)

    render(<MobileHeader />)
    expect(screen.getByText(/detect ai/i)).toBeInTheDocument()
  })

  it('opens sidebar sheet when menu button is clicked', () => {
    render(<MobileHeader />)
    const menuButton = screen.getAllByRole('button')[0] // Menu button is first
    fireEvent.click(menuButton)
    
    // Check if "New Chat" button from sidebar is visible (it's inside the sheet)
    expect(screen.getByText(/new chat/i)).toBeInTheDocument()
  })

  it('handles new chat button in sidebar', () => {
    render(<MobileHeader />)
    const menuButton = screen.getAllByRole('button')[0]
    fireEvent.click(menuButton)
    
    const newChatButton = screen.getByText(/new chat/i)
    fireEvent.click(newChatButton)
    
    expect(mockSetCurrentChatId).toHaveBeenCalledWith(null)
  })
})
