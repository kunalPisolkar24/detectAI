import { render } from '@testing-library/react'
import { describe, it, vi, beforeEach } from 'vitest'
import { ChatView } from './chat-view'
import { MessageList } from './message-list'
import { MessageItem } from './message-item'
import { ChatHeader } from './layout/chat-header'
import { MobileHeader } from './layout/mobile-header'
import { Sidebar } from './layout/sidebar'
import { SidebarItem } from './layout/sidebar-item'
import { UserMenu } from './layout/user-menu'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock dependencies
vi.mock('../stores/ui-store', () => ({
  useChatUIStore: vi.fn((selector) => selector ? selector({
    selectedModel: 'spark',
    isSidebarOpen: true,
    currentChatId: 'chat-1',
    setCurrentChatId: vi.fn(),
    toggleSidebar: vi.fn(),
    setSidebarOpen: vi.fn(),
  }) : {
    selectedModel: 'spark',
    isSidebarOpen: true,
    currentChatId: 'chat-1',
  }),
}))

vi.mock('./message-list', () => ({
  MessageList: () => <div data-testid="message-list" />
}))

vi.mock('./chat-input', () => ({
  ChatInput: () => <div data-testid="chat-input" />
}))

vi.mock('../hooks/use-chat-history', () => ({
  useChatSession: vi.fn(() => ({ data: { id: 'chat-1', messages: [] }, isLoading: false })),
  useChatHistory: vi.fn(() => ({ data: [], isLoading: false })),
}))

vi.mock('../hooks/use-chat-mutation', () => ({
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

  it('renders ChatHeader without crashing', () => {
    render(<ChatHeader />, { wrapper })
  })

  it('renders MobileHeader without crashing', () => {
    render(<MobileHeader />, { wrapper })
  })

  it('renders Sidebar without crashing', () => {
    render(<Sidebar />, { wrapper })
  })

  it('renders SidebarItem without crashing', () => {
    const mockChat = { id: '1', title: 'Test', createdAt: new Date() }
    render(<SidebarItem chat={mockChat as any} />)
  })

  it('renders UserMenu without crashing', () => {
    render(<UserMenu isCollapsed={false} />)
  })
})
