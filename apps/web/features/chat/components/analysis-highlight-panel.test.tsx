import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { AnalysisHighlightPanel } from './analysis-highlight-panel'
import { AnalysisHighlightSpan } from '../types'

vi.mock('@/lib/core/fonts', () => ({
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

describe('AnalysisHighlightPanel', () => {
  const sourceText = 'This is a test sentence. This is another one.'
  const highlights: AnalysisHighlightSpan[] = [
    { charStart: 0, charEnd: 23, label: 'AI', aiConfidence: 0.9 },
    { charStart: 25, charEnd: 45, label: 'Human', aiConfidence: 0.1 },
  ]

  it('renders nothing when text or highlights are missing', () => {
    const { container } = render(<AnalysisHighlightPanel sourceText="" highlights={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders highlighted segments correctly', () => {
    render(<AnalysisHighlightPanel sourceText={sourceText} highlights={highlights} />)
    // charStart: 0, charEnd: 23 is 'This is a test sentence' (no dot)
    expect(screen.getByText('This is a test sentence')).toBeInTheDocument()
    // charStart: 25, charEnd: 45 is 'This is another one.'
    expect(screen.getByText('This is another one.')).toBeInTheDocument()
    
    // Check titles for confidence
    expect(screen.getByTitle(/AI confidence 90%/i)).toBeInTheDocument()
  })

  it('handles expand/collapse logic for long text', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const longText = 'long '.repeat(200) // 1000 chars > 600 threshold
    const longHighlights: AnalysisHighlightSpan[] = [
      { charStart: 0, charEnd: 50, label: 'AI', aiConfidence: 0.9 }
    ]

    render(<AnalysisHighlightPanel sourceText={longText} highlights={longHighlights} />)
    
    const expandBtn = screen.getByText(/EXPAND FULL TEXT/i)
    expect(expandBtn).toBeInTheDocument()
    
    // Initially has max-height class
    // Find the container that has the merriweather class (the text content area)
    const textContainer = expandBtn.closest('.flex-col')?.querySelector('.merriweather')?.parentElement
    expect(textContainer).toHaveClass('max-h-64')
    
    await user.click(expandBtn)
    expect(screen.getByText(/COLLAPSE/i)).toBeInTheDocument()
    expect(textContainer).not.toHaveClass('max-h-64')
  })
})
