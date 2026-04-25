import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { ProfileView } from './profile-view'

// Mock the child tabs to isolate testing to the ProfileView container
vi.mock('./general-tab', () => ({
  GeneralTab: () => <div data-testid="mock-general-tab">General Tab Content</div>,
}))

vi.mock('./billing-tab', () => ({
  BillingTab: () => <div data-testid="mock-billing-tab">Billing Tab Content</div>,
}))

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return {
    ...actual,
    m: {
      div: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  }
})

vi.mock('@/lib/core/fonts', () => ({
  teko: { className: 'teko' },
  merriweather: { className: 'merriweather' },
  inter: { className: 'inter' },
}))

describe('ProfileView', () => {
  const mockUser = {
    id: 'user-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    image: null,
    createdAt: new Date('2024-01-01'),
    isPremium: false,
    apiCallCountDaily: 10,
    apiCallCountTotal: 100,
    subscriptionEndsAt: null,
    paddleSubscriptionStatus: null,
    paddleCancellationScheduled: false,
  }

  it('renders General tab by default', () => {
    render(<ProfileView user={mockUser} />)
    expect(screen.getByTestId('mock-general-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-billing-tab')).not.toBeInTheDocument()
  })

  it('switches to Billing tab when clicked (desktop nav)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<ProfileView user={mockUser} />)
    
    // There are two "Billing" buttons (desktop and mobile). 
    // We can select the first one.
    const billingButtons = screen.getAllByRole('button', { name: /Billing/i })
    await user.click(billingButtons[0])
    
    expect(screen.getByTestId('mock-billing-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-general-tab')).not.toBeInTheDocument()
  })

  it('switches back to General tab when clicked', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<ProfileView user={mockUser} />)
    
    // Switch to Billing first
    const billingButtons = screen.getAllByRole('button', { name: /Billing/i })
    await user.click(billingButtons[0])
    
    // Switch back to General
    const generalButtons = screen.getAllByRole('button', { name: /General/i })
    await user.click(generalButtons[0])
    
    expect(screen.getByTestId('mock-general-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-billing-tab')).not.toBeInTheDocument()
  })
})
