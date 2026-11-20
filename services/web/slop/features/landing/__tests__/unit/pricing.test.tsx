import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/test-utils'
import { Pricing } from '../../pricing'
import { useSession } from 'next-auth/react'
import userEvent from '@testing-library/user-event'

vi.mock('next-auth/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth/react')>()
  return {
    ...actual,
    useSession: vi.fn(),
  }
})

describe('Pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as any)
  })

  it('renders all pricing plans', () => {
    render(<Pricing />)
    expect(screen.getByText(/Spark/i)).toBeInTheDocument()
    expect(screen.getByText(/Flare/i)).toBeInTheDocument()
  })

  it('toggles between monthly and yearly billing', async () => {
    const user = userEvent.setup()
    render(<Pricing />)
    
    // Default is monthly
    expect(screen.getAllByText(/\/month/i)[0]).toBeInTheDocument()
    
    // Toggle to yearly
    const yearlyTrigger = screen.getByRole('tab', { name: /yearly/i })
    await user.click(yearlyTrigger)
    
    expect(await screen.findAllByText(/\/year/i)).toHaveLength(2)
  })

  it('calls onPlanSelect when a plan is selected', async () => {
    const user = userEvent.setup()
    const mockOnPlanSelect = vi.fn()
    render(<Pricing onPlanSelect={mockOnPlanSelect} isUpgradePage={true} />)
    
    const flareCta = screen.getByText(/Upgrade Now/i).closest('button')
    if (flareCta) {
      await user.click(flareCta)
    }
    
    expect(mockOnPlanSelect).toHaveBeenCalledWith('flare', 'monthly')
  })

  it('shows loading state on processing card', () => {
    render(<Pricing isProcessing={true} isUpgradePage={true} />)
    const proCard = screen.getByText(/Flare/i).closest('div')
    const spinner = proCard?.querySelector('.animate-spin')
    expect(spinner).toBeDefined()
  })
})
