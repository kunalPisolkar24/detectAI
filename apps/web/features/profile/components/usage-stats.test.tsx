import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { UsageStats } from './usage-stats'

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return {
    ...actual,
    m: {
      div: ({ children, className, initial, animate, transition, ...props }: any) => (
        <div className={className} {...props}>
          {children}
        </div>
      ),
    },
  }
})

vi.mock('@/lib/core/fonts', () => ({
  teko: { className: 'teko' },
  merriweather: { className: 'merriweather' },
  inter: { className: 'inter' },
}))

describe('UsageStats', () => {
  it('renders correctly for free users', () => {
    render(<UsageStats dailyCount={45} totalCount={1250} isPremium={false} />)
    
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('Standard')).toBeInTheDocument()
    expect(screen.getByText('1,250')).toBeInTheDocument()
    expect(screen.getByText('total scans performed')).toBeInTheDocument()
  })

  it('renders correctly for premium users', () => {
    render(<UsageStats dailyCount={150} totalCount={5000} isPremium={true} />)
    
    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByText('Unlimited')).toBeInTheDocument()
    expect(screen.getByText('5,000')).toBeInTheDocument()
    // Should not show the 100 limit
    expect(screen.queryByText('100')).not.toBeInTheDocument()
  })

  it('shows red progress bar when usage is above 90%', () => {
    const { container } = render(<UsageStats dailyCount={95} totalCount={100} isPremium={false} />)
    const progressBar = container.querySelector('.bg-red-500')
    expect(progressBar).toBeInTheDocument()
  })
})
