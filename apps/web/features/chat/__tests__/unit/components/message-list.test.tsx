import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { MessageList } from '../../../components/message-list'
import { useChatUIStore } from '../../../stores/ui-store'
import { useChatSession } from '../../../hooks/use-chat-history'
import { useSendMessage } from '../../../hooks/use-chat-mutation'
import userEvent from '@testing-library/user-event'

vi.mock('../../../stores/ui-store', () => ({
  useChatUIStore: vi.fn(),
}))

vi.mock('../../../hooks/use-chat-history', () => ({
  useChatSession: vi.fn(),
}))

vi.mock('../../../hooks/use-chat-mutation', () => ({
  useSendMessage: vi.fn(),
}))

// Mock MessageItem to simplify testing of MessageList logic
vi.mock('../../../components/message-item', () => ({
  MessageItem: ({ message, sourceText, onRetry }: any) => (
    <div data-testid={`message-${message.id}`}>
      <span>{message.content}</span>
      {sourceText && <span data-testid="source-text">{sourceText}</span>}
      {onRetry && <button onClick={onRetry} data-testid="retry-button">Retry</button>}
    </div>
  ),
}))

describe('MessageList', () => {
  const mockRetryAnalysis = vi.fn()
  
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useChatUIStore).mockReturnValue({ currentChatId: 'chat-1' } as any)
    vi.mocked(useSendMessage).mockReturnValue({
      retryAnalysis: mockRetryAnalysis,
      isAnalyzing: false,
    } as any)
    
    // Mock scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  it('renders empty state when there are no messages', () => {
    vi.mocked(useChatSession).mockReturnValue({ data: { messages: [] } } as any)
    
    render(<MessageList />)
    
    expect(screen.getByText(/Human or AI\?/i)).toBeInTheDocument()
    expect(screen.getByText(/Know in seconds\./i)).toBeInTheDocument()
  })

  it('renders model and capability hints in the empty state', () => {
    vi.mocked(useChatSession).mockReturnValue({ data: { messages: [] } } as any)

    render(<MessageList />)

    expect(screen.getByText('SPARK')).toBeInTheDocument()
    expect(screen.getByText('FLARE')).toBeInTheDocument()
    expect(screen.getByText(/Chunk-level highlights/i)).toBeInTheDocument()
    expect(screen.getByText(/AI vs human scores/i)).toBeInTheDocument()
  })

  it('renders a list of messages', () => {
    const messages = [
      { id: '1', role: 'user', content: 'Hello' },
      { id: '2', role: 'assistant', content: 'Hi there' },
    ]
    vi.mocked(useChatSession).mockReturnValue({ data: { messages } } as any)
    
    render(<MessageList />)
    
    expect(screen.getByTestId('message-1')).toBeInTheDocument()
    expect(screen.getByTestId('message-2')).toBeInTheDocument()
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('passes sourceText to assistant messages when analysis metadata is present', () => {
    const messages = [
      { id: '1', role: 'user', content: 'User text' },
      { 
        id: '2', 
        role: 'assistant', 
        content: 'Analysis',
        analysisLink: { sourceMessageId: '1' }
      },
    ]
    vi.mocked(useChatSession).mockReturnValue({ data: { messages } } as any)
    
    render(<MessageList />)
    
    expect(screen.getByTestId('source-text')).toHaveTextContent('User text')
  })

  it('handles retry analysis on assistant messages', async () => {
    const user = userEvent.setup()
    const createdAt = new Date()
    const messages = [
      { id: '1', role: 'user', content: 'User text' },
      { 
        id: '2', 
        role: 'assistant', 
        content: 'Analysis',
        createdAt,
        streamingProgress: { sourceMessageId: '1', retryContent: 'User text', model: 'spark' }
      },
    ]
    vi.mocked(useChatSession).mockReturnValue({ data: { messages } } as any)
    
    render(<MessageList />)
    
    const retryButton = screen.getByTestId('retry-button')
    await user.click(retryButton)
    
    expect(mockRetryAnalysis).toHaveBeenCalledWith({
      assistantMessageId: '2',
      assistantCreatedAt: createdAt,
      sourceMessageId: '1',
      content: 'User text',
      model: 'spark',
    })
  })
})
