import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
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

  it('handles rename dialog', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    vi.mocked(useChatSession).mockReturnValue({
      data: { title: 'Test Chat' },
      isLoading: false,
    } as any)

    render(<ChatHeader />)

    // Open dropdown (Radix menus respond to pointer events, not bare clicks)
    await user.click(screen.getByRole('button'))

    // Click rename
    await user.click(await screen.findByText(/rename/i))

    expect(await screen.findByText(/rename chat/i)).toBeInTheDocument()

    // Change title and save (user.click() on the submit button does not
    // trigger jsdom's form submission, so submit the form directly)
    const input = await screen.findByPlaceholderText(/chat title/i)
    fireEvent.change(input, { target: { value: 'New Title' } })
    fireEvent.submit(input.closest('form')!)

    expect(mockRenameChat.mutate).toHaveBeenCalledWith({
      id: 'chat-1',
      title: 'New Title'
    })
  })

  it('handles delete dialog', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    vi.mocked(useChatSession).mockReturnValue({
      data: { title: 'Test Chat' },
      isLoading: false,
    } as any)

    render(<ChatHeader />)

    // Open dropdown (Radix menus respond to pointer events, not bare clicks)
    await user.click(screen.getByRole('button'))

    // Click delete
    await user.click(await screen.findByText(/^delete$/i))

    expect(await screen.findByText(/delete chat\?/i)).toBeInTheDocument()

    // Confirm delete
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    expect(mockDeleteChat.mutate).toHaveBeenCalledWith('chat-1')
  })
})
