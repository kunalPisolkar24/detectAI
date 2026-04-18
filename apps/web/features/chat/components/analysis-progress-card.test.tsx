import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { AnalysisProgressCard } from './analysis-progress-card'
import { StreamingAnalysisProgress } from '../types'

vi.mock('@/lib/fonts', () => ({
  teko: { className: 'teko' },
  merriweather: { className: 'merriweather' },
  inter: { className: 'inter' },
}))

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return {
    ...actual,
    m: {
      div: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
    },
  }
})

describe('AnalysisProgressCard', () => {
  const defaultProgress: StreamingAnalysisProgress = {
    model: 'spark',
    status: 'running',
    processedChunks: 2,
    totalChunks: 10,
  }

  it('renders running state with correct progress', () => {
    render(<AnalysisProgressCard progress={defaultProgress} />)
    expect(screen.getByText(/Analyzing/i)).toBeInTheDocument()
    expect(screen.getByText('2/10 chunks analyzed')).toBeInTheDocument()
    expect(screen.getByText('20%')).toBeInTheDocument()
  })

  it('renders preparing state when totalChunks is 0', () => {
    render(<AnalysisProgressCard progress={{ ...defaultProgress, totalChunks: 0 }} />)
    expect(screen.getByText(/Preparing analysis/i)).toBeInTheDocument()
    expect(screen.getByText('5%')).toBeInTheDocument() // Component default for running with 0 chunks
  })

  it('renders cancelled state correctly', () => {
    render(<AnalysisProgressCard progress={{ ...defaultProgress, status: 'cancelled' }} />)
    expect(screen.getByText(/Canceled/i)).toBeInTheDocument()
    expect(screen.getByText(/This analysis was stopped/i)).toBeInTheDocument()
  })

  it('renders failed state and retry button', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onRetry = vi.fn()
    render(
      <AnalysisProgressCard 
        progress={{ ...defaultProgress, status: 'failed', error: 'Custom error message' }} 
        onRetry={onRetry}
      />
    )
    
    expect(screen.getByText(/Retry Available/i)).toBeInTheDocument()
    expect(screen.getByText('Custom error message')).toBeInTheDocument()
    
    const retryBtn = screen.getByRole('button', { name: /RETRY/i })
    await user.click(retryBtn)
    expect(onRetry).toHaveBeenCalled()
  })

  it('disables retry button when isRetryDisabled is true', () => {
    const onRetry = vi.fn()
    render(
      <AnalysisProgressCard 
        progress={{ ...defaultProgress, status: 'failed' }} 
        onRetry={onRetry}
        isRetryDisabled={true}
      />
    )
    
    expect(screen.getByRole('button', { name: /RETRY/i })).toBeDisabled()
  })
})
