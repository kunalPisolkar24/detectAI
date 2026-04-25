import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { MessageItem } from './message-item'
import type { Message } from '../types'

vi.mock('./analysis-card', () => ({
  AnalysisCard: ({ result }: any) => <div data-testid="analysis-card">{result.overallLabel}</div>,
}))

vi.mock('./analysis-highlight-panel', () => ({
  AnalysisHighlightPanel: ({ sourceText }: any) => (
    <div data-testid="analysis-highlight-panel">{sourceText}</div>
  ),
}))

vi.mock('./analysis-progress-card', () => ({
  AnalysisProgressCard: ({ progress, onRetry, isRetryDisabled }: any) => (
    <div data-testid="analysis-progress-card" data-status={progress.status}>
      {onRetry && <button onClick={onRetry} disabled={isRetryDisabled}>Retry</button>}
    </div>
  ),
}))

const baseUserMessage: Message = {
  id: 'msg-1',
  role: 'user',
  content: 'Hello, world!',
  createdAt: new Date('2024-01-01'),
}

const baseAssistantMessage: Message = {
  id: 'msg-2',
  role: 'assistant',
  content: '',
  createdAt: new Date('2024-01-01'),
}

describe('MessageItem', () => {
  it('renders user message content', () => {
    render(<MessageItem message={baseUserMessage} />)
    expect(screen.getByText('Hello, world!')).toBeInTheDocument()
  })

  it('renders assistant message with streaming progress (running)', () => {
    const message: Message = {
      ...baseAssistantMessage,
      streamingProgress: {
        model: 'spark',
        processedChunks: 2,
        totalChunks: 10,
        status: 'running',
      },
    }
    render(<MessageItem message={message} />)
    const card = screen.getByTestId('analysis-progress-card')
    expect(card).toBeInTheDocument()
    expect(card).toHaveAttribute('data-status', 'running')
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('renders assistant message with streaming progress (failed) and retry button', () => {
    const mockRetry = vi.fn()
    const message: Message = {
      ...baseAssistantMessage,
      streamingProgress: {
        model: 'spark',
        processedChunks: 2,
        totalChunks: 10,
        status: 'failed',
      },
    }
    render(<MessageItem message={message} onRetry={mockRetry} />)
    const retryButton = screen.getByRole('button', { name: /retry/i })
    expect(retryButton).toBeInTheDocument()
    retryButton.click()
    expect(mockRetry).toHaveBeenCalled()
  })

  it('renders assistant message with analysisStatus', () => {
    const message: Message = {
      ...baseAssistantMessage,
      analysisStatus: {
        model: 'spark',
        state: 'failed',
        error: 'Something went wrong',
        sourceMessageId: 'msg-2',
      },
    }
    render(<MessageItem message={message} />)
    expect(screen.getByTestId('analysis-progress-card')).toBeInTheDocument()
    expect(screen.getByTestId('analysis-progress-card')).toHaveAttribute('data-status', 'failed')
  })

  it('renders completed analysis with cards', () => {
    const message: Message = {
      ...baseAssistantMessage,
      analysis: {
        overallLabel: 'AI',
        overallScore: 0.9,
        highlights: [],
        chunks: [],
        model: 'spark',
      } as any,
    }
    render(<MessageItem message={message} sourceText="some text" />)
    expect(screen.getByTestId('analysis-highlight-panel')).toBeInTheDocument()
    expect(screen.getByTestId('analysis-card')).toBeInTheDocument()
    expect(screen.getByText('some text')).toBeInTheDocument()
  })

  it('renders null for assistant message with no data', () => {
    render(<MessageItem message={baseAssistantMessage} />)
    expect(screen.queryByTestId('analysis-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('analysis-progress-card')).not.toBeInTheDocument()
  })
})
