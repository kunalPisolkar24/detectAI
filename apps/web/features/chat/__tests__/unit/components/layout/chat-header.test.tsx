import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/test-utils'
import { ChatHeader } from '../../../../components/layout/chat-header'
import { useChatUIStore } from '../../../../stores/ui-store'
import { useChatSession } from '../../../../hooks/use-chat-history'
import { useChatMutations } from '../../../../hooks/use-chat-mutation'

vi.mock('../../../../stores/ui-store', () => ({
  useChatUIStore: vi.fn(),
}))

vi.mock('../../../../hooks/use-chat-history', () => ({
  useChatSession: vi.fn(),
}))

vi.mock('../../../../hooks/use-chat-mutation', () => ({
  useChatMutations: vi.fn(),
}))

describe('ChatHeader', () => {
  const mockDeleteChat = { mutate: vi.fn() }
  const mockRenameChat = { mutate: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useChatUIStore).mockReturnValue({
      currentChatId: 'chat-1',
    } as any)
    vi.mocked(useChatMutations).mockReturnValue({
      deleteChat: mockDeleteChat,
      renameChat: mockRenameChat,
    } as any)
  })

  it('renders chat title', () => {
    vi.mocked(useChatSession).mockReturnValue({
      data: { title: 'Test Chat' },
      isLoading: false,
    } as any)

    render(<ChatHeader />)
    expect(screen.getByText('Test Chat')).toBeInTheDocument()
  })

  it('returns null if no chat id or session', () => {
    vi.mocked(useChatUIStore).mockReturnValue({ currentChatId: null } as any)
    const { container } = render(<ChatHeader />)
    expect(container.firstChild).toBeNull()
  })

  it.skip('handles rename dialog', async () => {
    vi.mocked(useChatSession).mockReturnValue({
      data: { title: 'Test Chat' },
      isLoading: false,
    } as any)

    render(<ChatHeader />)
    
    // Open dropdown
    const trigger = screen.getByRole('button')
    fireEvent.click(trigger)
    
    // Click rename
    const renameButton = screen.getByText(/rename/i)
    fireEvent.click(renameButton)
    
    expect(screen.getByText(/rename chat/i)).toBeInTheDocument()
    
    // Change title and save
    const input = screen.getByPlaceholderText(/chat title/i)
    fireEvent.change(input, { target: { value: 'New Title' } })
    
    const saveButton = screen.getByText(/save/i)
    fireEvent.click(saveButton)
    
    expect(mockRenameChat.mutate).toHaveBeenCalledWith({
      id: 'chat-1',
      title: 'New Title'
    })
  })

  it.skip('handles delete dialog', async () => {
    vi.mocked(useChatSession).mockReturnValue({
      data: { title: 'Test Chat' },
      isLoading: false,
    } as any)

    render(<ChatHeader />)
    
    // Open dropdown
    const trigger = screen.getByRole('button')
    fireEvent.click(trigger)
    
    // Click delete
    const deleteButton = screen.getByText(/delete/i)
    fireEvent.click(deleteButton)
    
    expect(screen.getByText(/delete chat\?/i)).toBeInTheDocument()
    
    // Confirm delete
    const confirmButton = screen.getByRole('button', { name: /delete/i })
    fireEvent.click(confirmButton)
    
    expect(mockDeleteChat.mutate).toHaveBeenCalledWith('chat-1')
  })
})
