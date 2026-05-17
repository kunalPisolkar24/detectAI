import { render, fireEvent } from '@testing-library/react'
import { describe, it, vi } from 'vitest'
import { ChatView } from '../../../components/chat-view'
import { MessageItem } from '../../../components/message-item'
import { ChatHeader } from '../../../components/layout/chat-header'
import { MobileHeader } from '../../../components/layout/mobile-header'
import { Sidebar } from '../../../components/layout/sidebar'
import { SidebarItem } from '../../../components/layout/sidebar-item'
import { UserMenu } from '../../../components/layout/user-menu'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock dependencies
vi.mock('../../../stores/ui-store', () => {
  const state = {
    selectedModel: 'spark',
    isSidebarOpen: true,
    currentChatId: 'chat-1',
    setCurrentChatId: vi.fn(),
    toggleSidebar: vi.fn(),
    setSidebarOpen: vi.fn(),
  }
  return {
    useChatUIStore: vi.fn((selector) => selector ? selector(state) : state)
  }
})

vi.mock('../../../components/chat-input', () => ({
  ChatInput: () => <div data-testid="chat-input" />
}))

vi.mock('../../../hooks/use-chat-history', () => ({
  useChatSession: vi.fn(() => ({ data: { id: 'chat-1', messages: [] }, isLoading: false })),
  useChatHistory: vi.fn(() => ({ data: [], isLoading: false })),
}))

vi.mock('../../../hooks/use-chat-mutation', () => ({
  useSendMessage: vi.fn(() => ({ isAnalyzing: false })),
  useChatMutations: vi.fn(() => ({ deleteChat: { mutate: vi.fn() }, renameChat: { mutate: vi.fn() } })),
}))

const queryClient = new QueryClient()
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

describe('Chat UI Structural Rendering', () => {
  it('renders ChatView without crashing', () => {
    render(<ChatView />, { wrapper })
  })

  it('renders MessageItem without crashing', () => {
    const mockMessage = { id: '1', role: 'user', content: 'test', createdAt: new Date() }
    render(<MessageItem message={mockMessage as any} />)
  })

  it('renders ChatHeader and handles interactions', () => {
    const { getAllByRole } = render(<ChatHeader />, { wrapper })
    const buttons = getAllByRole('button')
    if (buttons.length > 0) {
      fireEvent.click(buttons[0])
    }
  })

  it('renders MobileHeader and handles toggle', () => {
    const { getAllByRole } = render(<MobileHeader />, { wrapper })
    const buttons = getAllByRole('button')
    if (buttons.length > 0) {
      fireEvent.click(buttons[0])
    }
  })

  it('renders Sidebar and handles toggle', () => {
    const { getAllByRole } = render(<Sidebar />, { wrapper })
    const buttons = getAllByRole('button')
    if (buttons.length > 0) {
      fireEvent.click(buttons[0])
    }
  })

  it('renders SidebarItem and handles interactions', async () => {
    const mockChat = { id: '1', title: 'Test', createdAt: new Date() }
    const { getByText, getAllByRole } = render(<SidebarItem chat={mockChat as any} />)
    
    const item = getByText('Test')
    fireEvent.click(item)
    
    const buttons = getAllByRole('button')
    if (buttons.length > 0) {
      fireEvent.click(buttons[0])
    }
  })

  it('renders UserMenu and handles interactions', async () => {
    const { getByRole } = render(<UserMenu isCollapsed={false} />)
    const trigger = getByRole('button')
    fireEvent.click(trigger)
  })
})
