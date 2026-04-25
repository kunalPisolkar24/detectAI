import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { axe } from 'jest-axe'
import { AnalysisCard } from './analysis-card'
import { AnalysisResult } from '../types'

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

describe('AnalysisCard', () => {
  const mockResult: AnalysisResult = {
    model: 'spark',
    label: 'AI',
    confidence: 0.85,
    scores: {
      human: 0.15,
      ai: 0.85,
    },
    highlights: [],
    raw: {},
  }

  it('renders correctly and has no accessibility violations', async () => {
    const { container } = render(<AnalysisCard result={mockResult} />)
    expect(screen.getByText(/Spark/i)).toBeInTheDocument()
    expect(screen.getByText(/85%/i)).toBeInTheDocument()
    expect(screen.getByText(/15%/i)).toBeInTheDocument()
    
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('shows AI label and correct colors when label is AI', () => {
    render(<AnalysisCard result={mockResult} />)
    expect(screen.getByText(/AI-GENERATED/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '85')
  })

  it('shows Human label and correct scores when label is Human', () => {
    const humanResult: AnalysisResult = {
      ...mockResult,
      label: 'Human',
      scores: { human: 0.92, ai: 0.08 }
    }
    render(<AnalysisCard result={humanResult} />)
    expect(screen.getByText(/HUMAN-WRITTEN/i)).toBeInTheDocument()
    expect(screen.getByText(/92%/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '8')
  })
})
