import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { TurnstileComponent } from './turnstile'

vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: vi.fn(({ siteKey, onSuccess }) => (
    <div data-testid="mock-turnstile-widget" data-sitekey={siteKey}>
      <button onClick={() => onSuccess('mock-token')}>Verify</button>
    </div>
  )),
}))

vi.mock('next-themes', () => ({
  useTheme: vi.fn(() => ({ theme: 'light' })),
}))

describe('TurnstileComponent', () => {
  const defaultProps = {
    siteKey: 'test-site-key',
    onVerify: vi.fn(),
    onError: vi.fn(),
    onExpire: vi.fn(),
    onTimeout: vi.fn(),
  }

  it('renders the turnstile widget with correct siteKey', () => {
    render(<TurnstileComponent {...defaultProps} />)
    const widget = screen.getByTestId('mock-turnstile-widget')
    expect(widget).toBeInTheDocument()
    expect(widget).toHaveAttribute('data-sitekey', 'test-site-key')
  })

  it('calls onVerify when verification is successful', async () => {
    const user = userEvent.setup()
    render(<TurnstileComponent {...defaultProps} />)
    const verifyButton = screen.getByText('Verify')
    await user.click(verifyButton)
    expect(defaultProps.onVerify).toHaveBeenCalledWith('mock-token')
  })
})
